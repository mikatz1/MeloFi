// MeloFi VST Host - a small helper process that hosts VST3 instruments and effects for MeloFi.
//
// Commands go over stdin / stdout, one JSON object per line:
//   -> {"id":1,"op":"scan","paths":["D:\\VST3"]}            <- {"id":1,"ok":true,"plugins":[...]}
//   -> {"id":2,"op":"load","slot":"c1","plugin":"<identifier or .vst3 path>","rate":48000,"effect":false}
//   -> {"id":3,"op":"render","slot":"c1","sr":48000,"seconds":8.5,"events":[[0.0,144,60,100],...],
//        "params":[[0.5,3,0.25,0],...],"out":"C:\\...\\x.wav"}       (offline, sample-exact)
//   -> {"id":4,"op":"params","slot":"c1"}                      <- {"ok":true,"params":[{"i":0,"name":..,"value":..},...]}
//   -> {"id":5,"op":"chain","slot":"c1","chain":["fx:c1:f1"]}  effects run right after an instrument
//   -> editor / getState / setState / config / unload / device / quit
//
// Live sound does not go to a sound card of its own: it streams back to MeloFi, which plays it
// through its mixer. MeloFi passes "--stream=<port>" and the helper connects to 127.0.0.1:<port>.
// Every message on that socket is  u32 length | u8 type | u8 slot length | slot | payload
// (little-endian, the length counts everything after itself):
//   1 render   (MeloFi -> helper)  f64 frame, u32 n            an instrument's next n frames
//   3 process  (MeloFi -> helper)  f64 frame, u32 n, f32 L[n], f32 R[n]   audio through an effect
//   4 events   (MeloFi -> helper)  UTF-8 JSON array: notes, parameter points, tempo (see Slot::event)
//   2 audio    (helper -> MeloFi)  f64 frame, u32 n, u8 status (0 ok, 1 no plugin), f32 L[n], f32 R[n]
// Frames are MeloFi's AudioContext frames, so a note or a parameter change lands on its exact sample.
// One thread serves the socket in order: events always reach a plugin before the audio they belong to.
#include <juce_audio_utils/juce_audio_utils.h>
#include <iostream>
#include <mutex>
#include <thread>
#include <atomic>

using namespace juce;

namespace
{
std::mutex outMutex;

void send (const var& v)
{
    const auto line = JSON::toString (v, true);
    std::lock_guard<std::mutex> g (outMutex);
    std::cout << line.toStdString() << "\n" << std::flush;
}

var obj (std::initializer_list<std::pair<const char*, var>> kv)
{
    auto* o = new DynamicObject();
    for (auto& [k, v] : kv)
        o->setProperty (k, v);
    return var (o);
}

var describe (const PluginDescription& d)
{
    return obj ({ { "id", d.createIdentifierString() },
                  { "file", d.fileOrIdentifier },
                  { "name", d.name },
                  { "vendor", d.manufacturerName },
                  { "category", d.category },
                  { "instrument", d.isInstrument },
                  { "format", d.pluginFormatName } });
}

constexpr int maxBlock = 4096; // the largest block MeloFi asks for (offline effect chunks)
} // namespace

// a plugin editor in its own window; closing only hides it
class EditorWindow final : public DocumentWindow
{
public:
    EditorWindow (const String& title, AudioProcessorEditor* ed)
        : DocumentWindow (title, Colour (0xff1b1c20), DocumentWindow::closeButton | DocumentWindow::minimiseButton)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (ed, true);
        setResizable (ed->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
    }
    void closeButtonPressed() override { setVisible (false); }
};

// the song position and tempo a plugin sees (tempo-synced delays, arpeggiators, LFOs)
struct Clock final : public AudioPlayHead
{
    std::atomic<double> bpm { 120.0 };
    std::atomic<bool> playing { false };
    std::atomic<int64> zero { 0 }; // the frame where the song starts
    double rate = 48000.0;
    int64 at = 0; // the frame being processed (set before each block)

    Optional<PositionInfo> getPosition() const override
    {
        PositionInfo p;
        const auto from = at - zero.load();
        p.setBpm (bpm.load());
        p.setIsPlaying (playing.load());
        p.setTimeInSamples (from);
        p.setTimeInSeconds ((double) from / rate);
        p.setPpqPosition ((double) from / rate * bpm.load() / 60.0);
        p.setTimeSignature (TimeSignature { 4, 4 });
        return p;
    }
};

// parameter automation: points on MeloFi's timeline, each one a step or the end of a ramp
struct Automation
{
    struct Point { int64 f; float v; bool ramp; };
    std::map<int, std::vector<Point>> points;
    std::map<int, float> applied; // what each parameter was last set to

    void add (int i, int64 f, float v, bool ramp)
    {
        auto& pts = points[i];
        auto it = std::upper_bound (pts.begin(), pts.end(), f, [] (int64 x, const Point& p) { return x < p.f; });
        pts.insert (it, { f, jlimit (0.0f, 1.0f, v), ramp });
    }
    void clearFrom (int i, int64 f)
    {
        auto pit = points.find (i);
        if (pit == points.end()) return;
        auto& pts = pit->second;
        pts.erase (std::remove_if (pts.begin(), pts.end(), [f] (const Point& p) { return p.f >= f; }), pts.end());
    }
    void clearAfter (int64 f)
    {
        for (auto& [i, pts] : points)
            pts.erase (std::remove_if (pts.begin(), pts.end(), [f] (const Point& p) { return p.f > f; }), pts.end());
    }
    static bool valueAt (const std::vector<Point>& pts, int64 x, float& v)
    {
        auto it = std::upper_bound (pts.begin(), pts.end(), x, [] (int64 a, const Point& p) { return a < p.f; });
        if (it == pts.begin()) return false;
        const auto& p = *(it - 1);
        if (it != pts.end() && it->ramp && it->f > p.f)
            v = p.v + (it->v - p.v) * (float) ((double) (x - p.f) / (double) (it->f - p.f));
        else
            v = p.v;
        return true;
    }
    // a ramp runs through [a, b): step it every 32 samples
    static bool ramping (const std::vector<Point>& pts, int64 a, int64 b)
    {
        for (size_t k = 1; k < pts.size(); ++k)
            if (pts[k].ramp && pts[k - 1].f < b && pts[k].f > a)
                return true;
        return false;
    }
    // forget what is behind `f` (the last point before it still counts)
    void prune (int64 f)
    {
        for (auto& [i, pts] : points)
        {
            auto it = std::upper_bound (pts.begin(), pts.end(), f, [] (int64 x, const Point& p) { return x < p.f; });
            if (it - pts.begin() > 1)
                pts.erase (pts.begin(), it - 1);
        }
    }
};

struct Slot
{
    std::unique_ptr<AudioPluginInstance> plugin;
    PluginDescription desc;
    std::unique_ptr<EditorWindow> window;
    CriticalSection lock; // the stream thread vs. load / state / offline render
    bool effect = false;
    Clock clock;
    // stream thread only
    std::vector<std::pair<int64, MidiMessage>> pending; // frame (-1: as soon as possible)
    Automation autom;
    int64 pos = 0; // where the stream got to
    bool silence = false; // all notes off at the next block
    AudioBuffer<float> work;
    // an instrument's VST effects that follow it directly in MeloFi's mixer: run here in the same
    // request, so live sound makes one round trip instead of one per plugin (under `lock`)
    std::vector<String> chain;
};
using SlotPtr = std::shared_ptr<Slot>;

class Host;

// the audio socket to MeloFi (see the top of this file)
class Stream final : public Thread
{
public:
    Stream (Host& h, int p) : Thread ("MeloFi VST stream"), host (h), port (p) {}
    ~Stream() override { stop(); }
    void stop()
    {
        signalThreadShouldExit();
        socket.close();
        stopThread (2000);
    }
    void run() override;
    std::atomic<bool> connected { false };

private:
    Host& host;
    int port;
    StreamingSocket socket;
    MemoryBlock in, out;
    bool readAll (void* d, int n)
    {
        auto* p = static_cast<char*> (d);
        while (n > 0)
        {
            const int r = socket.read (p, n, true);
            if (r <= 0) return false;
            p += r;
            n -= r;
        }
        return true;
    }
    void reply (const String& slot, int64 frame, int n, bool ok, const AudioBuffer<float>* audio);
};

class Host final
{
public:
    Host (int streamPort)
    {
        formats.addDefaultFormats();
        if (streamPort > 0)
        {
            stream = std::make_unique<Stream> (*this, streamPort);
            stream->startThread (Thread::Priority::highest);
        }
    }

    ~Host()
    {
        stream.reset();
        std::map<String, SlotPtr> gone;
        {
            const ScopedLock sl (mapLock);
            gone.swap (slots);
        }
        for (auto& [k, s] : gone)
        {
            s->window.reset();
            const ScopedLock l (s->lock);
            s->plugin.reset();
        }
    }

    SlotPtr find (const String& key)
    {
        const ScopedLock sl (mapLock);
        auto it = slots.find (key);
        return it == slots.end() ? nullptr : it->second;
    }

    // ---------- the stream thread ----------
    // events: [{"k":"on","n":60,"v":100,"f":12345,"ch":1}, {"k":"off",..}, {"k":"cc","cc":1,"v":64,"f":..},
    //          {"k":"p","i":3,"v":0.25,"f":..,"r":1}  (r: ramp to it), {"k":"pc","i":3,"f":..} (clear from f),
    //          {"k":"all"} (stop: notes off, scheduled things dropped), {"k":"tp","bpm":120,"play":1,"zero":..}]
    // f < 0: as soon as possible
    void events (Slot& s, const var& list)
    {
        auto* a = list.getArray();
        if (a == nullptr) return;
        for (auto& e : *a)
        {
            const String k = e["k"].toString();
            int64 f = (int64) (double) e.getProperty ("f", -1.0);
            if (f < 0) f = s.pos;
            const int ch = jlimit (1, 16, (int) e.getProperty ("ch", 1));
            auto queue = [&] (const MidiMessage& m)
            {
                auto it = std::upper_bound (s.pending.begin(), s.pending.end(), f, [] (int64 x, const std::pair<int64, MidiMessage>& p) { return x < p.first; });
                s.pending.insert (it, { f, m });
            };
            if (k == "on") queue (MidiMessage::noteOn (ch, jlimit (0, 127, (int) e["n"]), (uint8) jlimit (1, 127, (int) e.getProperty ("v", 100))));
            else if (k == "off") queue (MidiMessage::noteOff (ch, jlimit (0, 127, (int) e["n"])));
            else if (k == "cc") queue (MidiMessage::controllerEvent (ch, jlimit (0, 127, (int) e["cc"]), jlimit (0, 127, (int) e["v"])));
            else if (k == "p") s.autom.add ((int) e["i"], f, (float) (double) e["v"], (bool) e.getProperty ("r", false));
            else if (k == "pc") s.autom.clearFrom ((int) e["i"], f);
            else if (k == "all")
            {
                s.pending.clear();
                s.autom.clearAfter (s.pos);
                s.silence = true;
            }
            else if (k == "tp")
            {
                s.clock.bpm = jlimit (10.0, 999.0, (double) e.getProperty ("bpm", 120.0));
                s.clock.playing = (bool) e.getProperty ("play", false);
                s.clock.zero = (int64) (double) e.getProperty ("zero", 0.0);
            }
        }
    }

    // an instrument's frames [frame, frame + n), or an effect's input in `buf` processed in place
    bool streamBlock (Slot& s, int64 frame, int n, AudioBuffer<float>& io, bool effect)
    {
        const ScopedTryLock tl (s.lock);
        if (! tl.isLocked() || s.plugin == nullptr || effect != s.effect)
            return false;
        auto& p = *s.plugin;
        const int chans = jmax (2, p.getTotalNumInputChannels(), p.getTotalNumOutputChannels());
        s.work.setSize (chans, n, false, false, true);
        s.work.clear();
        if (effect)
        {
            const int ins = jmax (1, p.getTotalNumInputChannels());
            if (ins == 1)
            {
                s.work.addFrom (0, 0, io, 0, 0, n, 0.5f);
                s.work.addFrom (0, 0, io, 1, 0, n, 0.5f);
            }
            else
            {
                s.work.copyFrom (0, 0, io, 0, 0, n);
                s.work.copyFrom (1, 0, io, 1, 0, n);
            }
        }
        MidiBuffer midi;
        if (s.silence)
        {
            for (int c = 1; c <= 16; ++c)
                midi.addEvent (MidiMessage::allNotesOff (c), 0);
            s.silence = false;
        }
        size_t used = 0;
        while (used < s.pending.size() && s.pending[used].first < frame + n)
        {
            midi.addEvent (s.pending[used].second, (int) jlimit ((int64) 0, (int64) n - 1, s.pending[used].first - frame));
            ++used;
        }
        s.pending.erase (s.pending.begin(), s.pending.begin() + (long) used);
        run (s, s.autom, s.work, frame, n, midi);
        s.pos = frame + n;
        io.setSize (2, n, false, false, true);
        const int outs = jmax (1, p.getTotalNumOutputChannels());
        io.copyFrom (0, 0, s.work, 0, 0, n);
        io.copyFrom (1, 0, s.work, jmin (1, outs - 1), 0, n);
        return true;
    }

    std::vector<String> chainOf (Slot& s)
    {
        const ScopedLock l (s.lock);
        return s.chain;
    }

    // ---------- commands (message thread) ----------
    void handle (const String& line)
    {
        const auto msg = JSON::parse (line);
        const auto id = msg["id"];
        const String op = msg["op"].toString();
        auto reply = [&] (var v) { if (! id.isVoid()) { v.getDynamicObject()->setProperty ("id", id); send (v); } };
        auto fail = [&] (const String& e) { reply (obj ({ { "ok", false }, { "error", e } })); };
        try
        {
            if (op == "scan") return reply (scan (msg["paths"]));
            if (op == "device") return reply (obj ({ { "ok", true }, { "name", "MeloFi" }, { "type", "stream" }, { "stream", stream != nullptr && stream->connected.load() }, { "latency", 0.0 } }));
            if (op == "quit") { JUCEApplication::getInstance()->systemRequestedQuit(); return; }

            const String key = msg["slot"].toString();
            if (op == "load") return reply (load (key, msg));

            auto sp = find (key);
            if (sp == nullptr || sp->plugin == nullptr)
                return fail ("no_slot");
            auto& s = *sp;

            if (op == "unload")
            {
                {
                    const ScopedLock sl (mapLock);
                    slots.erase (key);
                }
                s.window.reset();
                const ScopedLock l (s.lock);
                s.plugin.reset();
                return reply (obj ({ { "ok", true } }));
            }
            if (op == "editor") return reply (editor (s));
            if (op == "params") return reply (params (s));
            if (op == "chain")
            {
                std::vector<String> list;
                if (auto* a = msg["chain"].getArray())
                    for (auto& k : *a)
                        list.push_back (k.toString());
                const ScopedLock l (s.lock);
                s.chain = std::move (list);
                return reply (obj ({ { "ok", true } }));
            }
            if (op == "config")
            {
                const ScopedLock l (s.lock);
                prepare (s, jlimit (8000.0, 192000.0, (double) msg.getProperty ("rate", s.clock.rate)));
                return reply (obj ({ { "ok", true } }));
            }
            if (op == "getState")
            {
                MemoryBlock mb;
                s.plugin->getStateInformation (mb);
                return reply (obj ({ { "ok", true }, { "state", Base64::toBase64 (mb.getData(), mb.getSize()) } }));
            }
            if (op == "setState")
            {
                MemoryOutputStream mo;
                if (! Base64::convertFromBase64 (mo, msg["state"].toString()))
                    return fail ("bad_state");
                const ScopedLock l (s.lock);
                s.plugin->setStateInformation (mo.getData(), (int) mo.getDataSize());
                s.autom.applied.clear();
                return reply (obj ({ { "ok", true }, { "latency", s.plugin->getLatencySamples() } }));
            }
            if (op == "render") return reply (render (s, msg));
            fail ("unknown_op");
        }
        catch (const std::exception& e)
        {
            fail (e.what());
        }
    }

private:
    AudioPluginFormatManager formats;
    CriticalSection mapLock;
    std::map<String, SlotPtr> slots;
    std::unique_ptr<Stream> stream;

    // process n frames starting at `at`, cut where automation points fall (sample-accurate),
    // ramps stepped every 32 samples
    static void run (Slot& s, Automation& au, AudioBuffer<float>& buf, int64 at, int n, const MidiBuffer& midi)
    {
        auto& p = *s.plugin;
        const auto& params = p.getParameters();
        std::vector<int> cuts { 0, n };
        bool ramp = false;
        for (auto& [i, pts] : au.points)
        {
            for (auto& q : pts)
                if (q.f > at && q.f < at + n)
                    cuts.push_back ((int) (q.f - at));
            ramp = ramp || Automation::ramping (pts, at, at + n);
        }
        if (ramp)
            for (int k = 32; k < n; k += 32)
                cuts.push_back (k);
        std::sort (cuts.begin(), cuts.end());
        cuts.erase (std::unique (cuts.begin(), cuts.end()), cuts.end());
        for (size_t c = 0; c + 1 < cuts.size(); ++c)
        {
            const int a = cuts[c], b = cuts[c + 1];
            for (auto& [i, pts] : au.points)
            {
                float v;
                if (i < 0 || i >= params.size() || ! Automation::valueAt (pts, at + a, v))
                    continue;
                auto it = au.applied.find (i);
                if (it == au.applied.end() || std::abs (it->second - v) > 1.0e-6f)
                {
                    params[i]->setValue (v);
                    au.applied[i] = v;
                }
            }
            AudioBuffer<float> view (buf.getArrayOfWritePointers(), buf.getNumChannels(), a, b - a);
            MidiBuffer sub;
            for (const auto m : midi)
                if (m.samplePosition >= a && m.samplePosition < b)
                    sub.addEvent (m.getMessage(), m.samplePosition - a);
            s.clock.at = at + a;
            p.processBlock (view, sub);
        }
        au.prune (at + n);
    }

    void prepare (Slot& s, double rate)
    {
        auto& p = *s.plugin;
        p.releaseResources();
        s.clock.rate = rate;
        p.setRateAndBufferSizeDetails (rate, maxBlock);
        p.prepareToPlay (rate, maxBlock);
        p.setPlayHead (&s.clock);
        s.autom.applied.clear();
    }

    AudioPluginFormat* vst3()
    {
        for (int i = 0; i < formats.getNumFormats(); ++i)
            if (formats.getFormat (i)->getName() == "VST3")
                return formats.getFormat (i);
        return nullptr;
    }

    var scan (const var& extra)
    {
        auto* f = vst3();
        if (f == nullptr)
            return obj ({ { "ok", false }, { "error", "no_vst3" } });
        FileSearchPath where (f->getDefaultLocationsToSearch());
        if (auto* a = extra.getArray())
            for (auto& p : *a)
                if (File::isAbsolutePath (p.toString()) && File (p.toString()).isDirectory())
                    where.add (File (p.toString()));
        Array<var> list;
        for (auto& file : f->searchPathsForPlugins (where, true, false))
        {
            OwnedArray<PluginDescription> found;
            f->findAllTypesForFile (found, file);
            for (auto* d : found)
                list.add (describe (*d));
        }
        return obj ({ { "ok", true }, { "plugins", list } });
    }

    var load (const String& key, const var& msg)
    {
        const String plugin = msg["plugin"].toString(), hint = msg["file"].toString();
        const double rate = jlimit (8000.0, 192000.0, (double) msg.getProperty ("rate", 48000.0));
        const bool effect = (bool) msg.getProperty ("effect", false);
        auto* f = vst3();
        if (f == nullptr)
            return obj ({ { "ok", false }, { "error", "no_vst3" } });
        // plugin: an identifier from scan ("VST3-Name-xxxx-yyyy") or a .vst3 path; hint: the file the
        // identifier was found in (saves a search, and finds plugins outside the default folders)
        String file = File::isAbsolutePath (plugin) ? plugin : (File::isAbsolutePath (hint) && File (hint).exists() ? hint : String());
        if (file.isEmpty())
        {
            for (auto& p : f->searchPathsForPlugins (FileSearchPath (f->getDefaultLocationsToSearch()), true, false))
            {
                OwnedArray<PluginDescription> found;
                f->findAllTypesForFile (found, p);
                for (auto* d : found)
                    if (d->createIdentifierString() == plugin) { file = p; break; }
                if (file.isNotEmpty())
                    break;
            }
            if (file.isEmpty())
                return obj ({ { "ok", false }, { "error", "not_found" } });
        }
        OwnedArray<PluginDescription> found;
        f->findAllTypesForFile (found, file);
        PluginDescription* pick = nullptr;
        for (auto* d : found)
            if (d->createIdentifierString() == plugin || pick == nullptr)
                pick = d;
        if (pick == nullptr)
            return obj ({ { "ok", false }, { "error", "not_a_plugin" } });
        String err;
        auto inst = formats.createPluginInstance (*pick, rate, maxBlock, err);
        if (inst == nullptr)
            return obj ({ { "ok", false }, { "error", err.isEmpty() ? String ("load_failed") : err } });
        if (effect)
        {
            // stereo in, stereo out where the plugin allows it (sidechain inputs stay off)
            auto layout = inst->getBusesLayout();
            if (layout.inputBuses.size() > 0) layout.inputBuses.getReference (0) = AudioChannelSet::stereo();
            if (layout.outputBuses.size() > 0) layout.outputBuses.getReference (0) = AudioChannelSet::stereo();
            if (inst->checkBusesLayoutSupported (layout))
                inst->setBusesLayout (layout);
        }
        else
            inst->enableAllBuses();
        auto s = std::make_shared<Slot>();
        s->desc = *pick;
        s->effect = effect;
        s->plugin = std::move (inst);
        prepare (*s, rate);
        SlotPtr old;
        {
            const ScopedLock sl (mapLock);
            if (auto it = slots.find (key); it != slots.end())
                old = it->second;
            slots[key] = s;
        }
        if (old != nullptr)
        {
            old->window.reset();
            const ScopedLock l (old->lock);
            old->plugin.reset();
        }
        auto& p = *s->plugin;
        return obj ({ { "ok", true }, { "plugin", describe (*pick) }, { "editor", p.hasEditor() }, { "params", p.getParameters().size() },
                      { "inputs", p.getTotalNumInputChannels() }, { "outputs", p.getTotalNumOutputChannels() }, { "latency", p.getLatencySamples() } });
    }

    var params (Slot& s)
    {
        Array<var> list;
        const auto& ps = s.plugin->getParameters();
        for (int i = 0; i < jmin (ps.size(), 4096); ++i)
        {
            auto* q = ps[i];
            list.add (obj ({ { "i", i }, { "name", q->getName (64) }, { "value", q->getValue() }, { "def", q->getDefaultValue() },
                             { "text", q->getCurrentValueAsText() }, { "label", q->getLabel() }, { "steps", q->getNumSteps() },
                             { "auto", q->isAutomatable() }, { "meta", q->isMetaParameter() } }));
        }
        return obj ({ { "ok", true }, { "params", list }, { "latency", s.plugin->getLatencySamples() } });
    }

    var editor (Slot& s)
    {
        if (! s.plugin->hasEditor())
            return obj ({ { "ok", false }, { "error", "no_editor" } });
        if (s.window == nullptr)
            if (auto* ed = s.plugin->createEditorIfNeeded())
                s.window = std::make_unique<EditorWindow> (s.desc.name + " - MeloFi", ed);
        if (s.window == nullptr)
            return obj ({ { "ok", false }, { "error", "no_editor" } });
        s.window->setVisible (true);
        s.window->toFront (true);
        return obj ({ { "ok", true } });
    }

    // an instrument, offline and sample-exact: the slot's live stream is silent meanwhile
    var render (Slot& s, const var& msg)
    {
        const double sr = jlimit (8000.0, 192000.0, (double) msg.getProperty ("sr", 48000.0));
        const double seconds = jlimit (0.0, 3600.0, (double) msg["seconds"]);
        const File out (msg["out"].toString());
        if (! File::isAbsolutePath (msg["out"].toString()))
            return obj ({ { "ok", false }, { "error", "bad_path" } });
        struct Ev { int64 at; MidiMessage m; };
        std::vector<Ev> evs;
        if (auto* a = msg["events"].getArray())
            for (auto& e : *a)
                if (auto* x = e.getArray(); x != nullptr && x->size() >= 4)
                {
                    const auto status = (int) (*x)[1];
                    evs.push_back ({ (int64) std::llround ((double) (*x)[0] * sr), MidiMessage (status, (int) (*x)[2], (int) (*x)[3]) });
                }
        std::stable_sort (evs.begin(), evs.end(), [] (const Ev& a, const Ev& b) { return a.at < b.at; });
        Automation au;
        if (auto* a = msg["params"].getArray())
            for (auto& e : *a)
                if (auto* x = e.getArray(); x != nullptr && x->size() >= 3)
                    au.add ((int) (*x)[1], (int64) std::llround ((double) (*x)[0] * sr), (float) (double) (*x)[2], x->size() > 3 && (bool) (*x)[3]);

        auto& p = *s.plugin;
        const int block = 512;
        const int64 total = (int64) std::ceil (seconds * sr);
        const int chans = jmax (2, p.getTotalNumInputChannels(), p.getTotalNumOutputChannels());
        AudioBuffer<float> result (2, (int) total);
        result.clear();
        {
            const ScopedLock l (s.lock);
            const double liveRate = s.clock.rate;
            const bool wasPlaying = s.clock.playing;
            const auto liveZero = s.clock.zero.load();
            p.releaseResources();
            p.setNonRealtime (true);
            prepare (s, sr);
            p.reset();
            s.clock.playing = true;
            s.clock.zero = (int64) std::llround ((double) msg.getProperty ("zero", 0.0) * sr);
            if (msg.hasProperty ("bpm")) s.clock.bpm = (double) msg["bpm"];
            AudioBuffer<float> buf (chans, block);
            size_t next = 0;
            for (int64 pos = 0; pos < total; pos += block)
            {
                const int n = (int) jmin ((int64) block, total - pos);
                buf.setSize (chans, n, false, false, true);
                buf.clear();
                MidiBuffer midi;
                while (next < evs.size() && evs[next].at < pos + n)
                {
                    midi.addEvent (evs[next].m, (int) jmax ((int64) 0, evs[next].at - pos));
                    ++next;
                }
                run (s, au, buf, pos, n, midi);
                for (int c = 0; c < 2; ++c)
                    result.copyFrom (c, (int) pos, buf, jmin (c, buf.getNumChannels() - 1), 0, n);
            }
            p.setNonRealtime (false);
            prepare (s, liveRate);
            s.clock.playing = wasPlaying;
            s.clock.zero = liveZero;
            s.silence = true;
        }
        out.deleteFile();
        auto file = std::make_unique<FileOutputStream> (out);
        if (! file->openedOk())
            return obj ({ { "ok", false }, { "error", "cannot_write" } });
        WavAudioFormat wav;
        std::unique_ptr<AudioFormatWriter> w (wav.createWriterFor (file.get(), sr, 2, 32, {}, 0));
        if (w == nullptr)
            return obj ({ { "ok", false }, { "error", "cannot_write" } });
        file.release(); // owned by the writer now
        w->writeFromAudioSampleBuffer (result, 0, result.getNumSamples());
        w.reset();
        return obj ({ { "ok", true }, { "out", out.getFullPathName() }, { "seconds", seconds } });
    }
};

void Stream::reply (const String& slot, int64 frame, int n, bool ok, const AudioBuffer<float>* audio)
{
    const auto key = slot.toStdString();
    const int body = 1 + 1 + (int) key.size() + 8 + 4 + 1 + (ok ? n * 8 : 0);
    out.setSize ((size_t) body + 4, false);
    auto* p = static_cast<char*> (out.getData());
    auto put = [&p] (const void* d, size_t z) { std::memcpy (p, d, z); p += z; };
    const uint32 len = (uint32) body;
    const uint8 type = 2, sl = (uint8) key.size(), st = ok ? 0 : 1;
    const double fr = (double) frame;
    const uint32 nn = (uint32) n;
    put (&len, 4); put (&type, 1); put (&sl, 1); put (key.data(), key.size()); put (&fr, 8); put (&nn, 4); put (&st, 1);
    if (ok)
    {
        put (audio->getReadPointer (0), (size_t) n * 4);
        put (audio->getReadPointer (1), (size_t) n * 4);
    }
    socket.write (out.getData(), (int) out.getSize());
}

void Stream::run()
{
    while (! threadShouldExit())
    {
        if (! socket.connect ("127.0.0.1", port, 3000))
        {
            wait (500);
            continue;
        }
        connected = true;
        AudioBuffer<float> io (2, maxBlock);
        for (;;)
        {
            uint32 len = 0;
            if (! readAll (&len, 4) || len < 2 || len > 64 * 1024 * 1024)
                break;
            in.setSize (len, false);
            if (! readAll (in.getData(), (int) len))
                break;
            const auto* d = static_cast<const uint8*> (in.getData());
            const uint8 type = d[0], sl = d[1];
            if (2u + sl > len)
                break;
            const String key (CharPointer_UTF8 (reinterpret_cast<const char*> (d + 2)), (size_t) sl);
            const auto* body = d + 2 + sl;
            const size_t left = len - 2 - sl;
            auto slot = host.find (key);
            if (type == 4)
            {
                if (slot != nullptr)
                    host.events (*slot, JSON::parse (String (CharPointer_UTF8 (reinterpret_cast<const char*> (body)), left)));
                continue;
            }
            if (left < 12)
                continue;
            double fr;
            uint32 n;
            std::memcpy (&fr, body, 8);
            std::memcpy (&n, body + 8, 4);
            const auto frame = (int64) fr;
            n = jmin (n, (uint32) maxBlock);
            io.setSize (2, (int) n, false, false, true);
            if (type == 3)
            {
                if (left < 12 + (size_t) n * 8)
                    continue;
                std::memcpy (io.getWritePointer (0), body + 12, (size_t) n * 4);
                std::memcpy (io.getWritePointer (1), body + 12 + (size_t) n * 4, (size_t) n * 4);
            }
            const bool ok = slot != nullptr && (type == 1 || type == 3) && host.streamBlock (*slot, frame, (int) n, io, type == 3);
            if (ok && type == 1)
                for (auto& k : host.chainOf (*slot))
                    if (auto fx = host.find (k))
                        host.streamBlock (*fx, frame, (int) n, io, true);
            reply (key, frame, (int) n, ok, &io);
        }
        connected = false;
        socket.close();
        if (! threadShouldExit())
            wait (200);
    }
}

class App final : public JUCEApplication
{
public:
    const String getApplicationName() override { return "MeloFi VST Host"; }
    const String getApplicationVersion() override { return "0.2.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const String& cmd) override
    {
        int port = 0;
        for (auto& a : StringArray::fromTokens (cmd, true))
            if (a.unquoted().startsWith ("--stream="))
                port = a.unquoted().fromFirstOccurrenceOf ("=", false, false).getIntValue();
        host = std::make_unique<Host> (port);
        reader = std::thread ([this] {
            std::string line;
            while (std::getline (std::cin, line))
            {
                const String s (CharPointer_UTF8 (line.c_str()));
                MessageManager::callAsync ([this, s] { if (host) host->handle (s); });
            }
            MessageManager::callAsync ([] { JUCEApplication::getInstance()->systemRequestedQuit(); });
        });
        send (obj ({ { "ready", true }, { "stream", port > 0 } }));
    }

    void shutdown() override
    {
        host.reset();
        if (reader.joinable())
            reader.detach(); // blocked on stdin; the process is exiting
    }

    void systemRequestedQuit() override { quit(); }

private:
    std::unique_ptr<Host> host;
    std::thread reader;
};

START_JUCE_APPLICATION (App)
