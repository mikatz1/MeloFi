// MeloFi Test Synth - a tiny VST3 instrument used to test the MeloFi VST Host (not shipped).
// Eight sine voices with a short attack / release and a "Gain" parameter.
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>

using namespace juce;

struct Sound final : SynthesiserSound
{
    bool appliesToNote (int) override { return true; }
    bool appliesToChannel (int) override { return true; }
};

struct Voice final : SynthesiserVoice
{
    bool canPlaySound (SynthesiserSound* s) override { return dynamic_cast<Sound*> (s) != nullptr; }
    void startNote (int note, float vel, SynthesiserSound*, int) override
    {
        phase = 0.0;
        delta = MathConstants<double>::twoPi * MidiMessage::getMidiNoteInHertz (note) / getSampleRate();
        level = vel * 0.25;
        env.setSampleRate (getSampleRate());
        env.setParameters ({ 0.005f, 0.1f, 0.8f, 0.08f });
        env.noteOn();
    }
    void stopNote (float, bool tail) override
    {
        if (tail) env.noteOff();
        else { env.reset(); clearCurrentNote(); }
    }
    void pitchWheelMoved (int) override {}
    void controllerMoved (int, int) override {}
    void renderNextBlock (AudioBuffer<float>& out, int start, int n) override
    {
        if (! isVoiceActive()) return;
        while (--n >= 0)
        {
            const auto e = env.getNextSample();
            const auto s = (float) (std::sin (phase) * level * e);
            for (int c = out.getNumChannels(); --c >= 0;)
                out.addSample (c, start, s);
            phase += delta;
            ++start;
            if (! env.isActive()) { clearCurrentNote(); break; }
        }
    }
    double phase = 0, delta = 0, level = 0;
    ADSR env;
};

class TestSynth final : public AudioProcessor
{
public:
    TestSynth()
        : AudioProcessor (BusesProperties().withOutput ("Output", AudioChannelSet::stereo(), true))
    {
        addParameter (gain = new AudioParameterFloat (ParameterID { "gain", 1 }, "Gain", 0.0f, 1.0f, 0.8f));
        for (int i = 0; i < 8; ++i)
            synth.addVoice (new Voice());
        synth.addSound (new Sound());
    }
    const String getName() const override { return "MeloFi Test Synth"; }
    void prepareToPlay (double sr, int) override { synth.setCurrentPlaybackSampleRate (sr); }
    void releaseResources() override {}
    void processBlock (AudioBuffer<float>& buf, MidiBuffer& midi) override
    {
        buf.clear();
        synth.renderNextBlock (buf, midi, 0, buf.getNumSamples());
        buf.applyGain (gain->get());
    }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.1; }
    AudioProcessorEditor* createEditor() override { return new GenericAudioProcessorEditor (*this); }
    bool hasEditor() const override { return true; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const String getProgramName (int) override { return "Default"; }
    void changeProgramName (int, const String&) override {}
    void getStateInformation (MemoryBlock& mb) override { MemoryOutputStream (mb, false).writeFloat (gain->get()); }
    void setStateInformation (const void* d, int n) override { if (n >= 4) *gain = MemoryInputStream (d, (size_t) n, false).readFloat(); }

private:
    Synthesiser synth;
    AudioParameterFloat* gain;
};

AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestSynth(); }
