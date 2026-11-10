// MeloFi VST Host - a small helper process that hosts VST3 instruments and effects for MeloFi.
//
// MeloFi talks to it over stdin / stdout, one JSON object per line:
//   -> {"id":1,"op":"scan","paths":["D:\\VST3"]}            <- {"id":1,"ok":true,"plugins":[...]}
//   -> {"id":2,"op":"load","slot":"c1","plugin":"<identifier or .vst3 path>"}
//   -> {"op":"note","slot":"c1","on":true,"n":60,"v":100}   (live, no reply)
//   -> {"id":3,"op":"render","slot":"c1","sr":48000,"seconds":8.5,"events":[[0.0,144,60,100],...],"out":"C:\\...\\x.wav"}
//   -> {"id":4,"op":"editor","slot":"c1"} / getState / setState / gain / unload / allOff / device / quit
// Live notes play through this process's own audio output; renders are offline and sample-exact.
#include <juce_audio_utils/juce_audio_utils.h>
#include <iostream>
#include <mutex>
#include <thread>

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

struct Slot
{
    std::unique_ptr<AudioPluginInstance> plugin;
    PluginDescription desc;
    MidiMessageCollector collector;
    std::unique_ptr<EditorWindow> window;
    float gain = 1.0f;
};

class Host final : public AudioIODeviceCallback
{
public:
    Host()
    {
        formats.addDefaultFormats();
        const auto err = devices.initialiseWithDefaultDevices (0, 2);
        if (err.isNotEmpty())
            deviceError = err;
        devices.addAudioCallback (this);
    }

    ~Host() override
    {
        devices.removeAudioCallback (this);
        const ScopedLock sl (lock);
        for (auto& [k, s] : slots)
            s->window.reset();
        slots.clear();
    }

    // ---------- audio callback: every loaded plugin, summed ----------
    void audioDeviceAboutToStart (AudioIODevice* d) override
    {
        const ScopedLock sl (lock);
        sampleRate = d->getCurrentSampleRate();
        blockSize = d->getCurrentBufferSizeSamples();
        for (auto& [k, s] : slots)
            prepare (*s);
    }

    void audioDeviceStopped() override {}

    void audioDeviceIOCallbackWithContext (const float* const*, int, float* const* out, int numOut, int n, const AudioIODeviceCallbackContext&) override
    {
        for (int c = 0; c < numOut; ++c)
            if (out[c] != nullptr)
                FloatVectorOperations::clear (out[c], n);
        const ScopedTryLock tl (lock);
        if (! tl.isLocked() || rendering)
            return;
        for (auto& [k, s] : slots)
        {
            if (s->plugin == nullptr)
                continue;
            auto& p = *s->plugin;
            const int chans = jmax (2, p.getTotalNumInputChannels(), p.getTotalNumOutputChannels());
            scratch.setSize (chans, n, false, false, true);
            scratch.clear();
            MidiBuffer midi;
            s->collector.removeNextBlockOfMessages (midi, n);
            p.processBlock (scratch, midi);
            for (int c = 0; c < numOut; ++c)
                if (out[c] != nullptr)
                    FloatVectorOperations::addWithMultiply (out[c], scratch.getReadPointer (jmin (c, scratch.getNumChannels() - 1)), s->gain, n);
        }
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
            if (op == "device") return reply (device());
            if (op == "quit") { JUCEApplication::getInstance()->systemRequestedQuit(); return; }

            const String key = msg["slot"].toString();
            if (op == "load") return reply (load (key, msg["plugin"].toString(), msg["file"].toString()));

            auto it = slots.find (key);
            if (it == slots.end() || it->second->plugin == nullptr)
                return fail ("no_slot");
            auto& s = *it->second;

            if (op == "note")
            {
                const int ch = jlimit (1, 16, (int) msg.getProperty ("ch", 1));
                const int n = jlimit (0, 127, (int) msg["n"]);
                const auto now = Time::getMillisecondCounterHiRes() * 0.001;
                if ((bool) msg["on"])
                    s.collector.addMessageToQueue (MidiMessage::noteOn (ch, n, (uint8) jlimit (1, 127, (int) msg.getProperty ("v", 100))).withTimeStamp (now));
                else
                    s.collector.addMessageToQueue (MidiMessage::noteOff (ch, n).withTimeStamp (now));
                return;
            }
            if (op == "cc")
            {
                s.collector.addMessageToQueue (MidiMessage::controllerEvent (1, (int) msg["cc"], (int) msg["value"]).withTimeStamp (Time::getMillisecondCounterHiRes() * 0.001));
                return;
            }
            if (op == "allOff")
            {
                for (int c = 1; c <= 16; ++c)
                    s.collector.addMessageToQueue (MidiMessage::allNotesOff (c).withTimeStamp (Time::getMillisecondCounterHiRes() * 0.001));
                return reply (obj ({ { "ok", true } }));
            }
            if (op == "gain") { s.gain = (float) (double) msg["gain"]; return reply (obj ({ { "ok", true } })); }
            if (op == "unload")
            {
                s.window.reset();
                const ScopedLock sl (lock);
                slots.erase (it);
                return reply (obj ({ { "ok", true } }));
            }
            if (op == "editor") return reply (editor (s));
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
                const ScopedLock sl (lock);
                s.plugin->setStateInformation (mo.getData(), (int) mo.getDataSize());
                return reply (obj ({ { "ok", true } }));
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
    AudioDeviceManager devices;
    String deviceError;
    CriticalSection lock;
    std::map<String, std::unique_ptr<Slot>> slots;
    AudioBuffer<float> scratch;
    double sampleRate = 48000.0;
    int blockSize = 512;
    bool rendering = false;

    void prepare (Slot& s)
    {
        s.plugin->setRateAndBufferSizeDetails (sampleRate, blockSize);
        s.plugin->prepareToPlay (sampleRate, blockSize);
        s.collector.reset (sampleRate);
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

    var device()
    {
        auto* d = devices.getCurrentAudioDevice();
        return obj ({ { "ok", d != nullptr },
                      { "name", d ? d->getName() : String() },
                      { "type", d ? d->getTypeName() : String() },
                      { "rate", sampleRate },
                      { "block", blockSize },
                      { "latency", d ? (d->getOutputLatencyInSamples() + blockSize) / sampleRate : 0.0 },
                      { "error", deviceError } });
    }

    var load (const String& key, const String& plugin, const String& hint)
    {
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
        auto inst = formats.createPluginInstance (*pick, sampleRate, blockSize, err);
        if (inst == nullptr)
            return obj ({ { "ok", false }, { "error", err.isEmpty() ? String ("load_failed") : err } });
        inst->enableAllBuses();
        auto s = std::make_unique<Slot>();
        s->desc = *pick;
        s->plugin = std::move (inst);
        prepare (*s);
        {
            const ScopedLock sl (lock);
            if (auto old = slots.find (key); old != slots.end())
                old->second->window.reset();
            slots[key] = std::move (s);
        }
        auto& p = *slots[key]->plugin;
        return obj ({ { "ok", true }, { "plugin", describe (*pick) }, { "editor", p.hasEditor() }, { "params", p.getParameters().size() },
                      { "outputs", p.getTotalNumOutputChannels() } });
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

    // offline, sample-exact: the realtime callback is paused while the plugin renders
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

        auto& p = *s.plugin;
        const int block = 512;
        const int64 total = (int64) std::ceil (seconds * sr);
        const int chans = jmax (2, p.getTotalNumInputChannels(), p.getTotalNumOutputChannels());
        AudioBuffer<float> result (2, (int) total);
        result.clear();
        {
            const ScopedLock sl (lock);
            rendering = true;
            p.releaseResources();
            p.setNonRealtime (true);
            p.setRateAndBufferSizeDetails (sr, block);
            p.prepareToPlay (sr, block);
            p.reset();
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
                p.processBlock (buf, midi);
                for (int c = 0; c < 2; ++c)
                    result.copyFrom (c, (int) pos, buf, jmin (c, buf.getNumChannels() - 1), 0, n);
            }
            p.releaseResources();
            p.setNonRealtime (false);
            prepare (s);
            rendering = false;
        }
        out.deleteFile();
        auto stream = std::make_unique<FileOutputStream> (out);
        if (! stream->openedOk())
            return obj ({ { "ok", false }, { "error", "cannot_write" } });
        WavAudioFormat wav;
        std::unique_ptr<AudioFormatWriter> w (wav.createWriterFor (stream.get(), sr, 2, 32, {}, 0));
        if (w == nullptr)
            return obj ({ { "ok", false }, { "error", "cannot_write" } });
        stream.release(); // owned by the writer now
        w->writeFromAudioSampleBuffer (result, 0, result.getNumSamples());
        w.reset();
        return obj ({ { "ok", true }, { "out", out.getFullPathName() }, { "seconds", seconds } });
    }
};

class App final : public JUCEApplication
{
public:
    const String getApplicationName() override { return "MeloFi VST Host"; }
    const String getApplicationVersion() override { return "0.1.0"; }
    bool moreThanOneInstanceAllowed() override { return true; }

    void initialise (const String&) override
    {
        host = std::make_unique<Host>();
        reader = std::thread ([this] {
            std::string line;
            while (std::getline (std::cin, line))
            {
                const String s (CharPointer_UTF8 (line.c_str()));
                MessageManager::callAsync ([this, s] { if (host) host->handle (s); });
            }
            MessageManager::callAsync ([] { JUCEApplication::getInstance()->systemRequestedQuit(); });
        });
        send (obj ({ { "ready", true } }));
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
