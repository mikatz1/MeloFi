// MeloFi Test Effect - a tiny VST3 effect used to test the MeloFi VST Host (not shipped).
// Stereo in, stereo out: the sound times (2 x "Gain"), so the default 0.5 passes it unchanged.
// No smoothing on purpose: a parameter change shows up at the exact sample it was applied.
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_basics/juce_audio_basics.h>

using namespace juce;

class TestEffect final : public AudioProcessor
{
public:
    TestEffect()
        : AudioProcessor (BusesProperties().withInput ("Input", AudioChannelSet::stereo(), true).withOutput ("Output", AudioChannelSet::stereo(), true))
    {
        addParameter (gain = new AudioParameterFloat (ParameterID { "gain", 1 }, "Gain", 0.0f, 1.0f, 0.5f));
    }
    const String getName() const override { return "MeloFi Test Effect"; }
    void prepareToPlay (double, int) override {}
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& l) const override
    {
        return l.getMainOutputChannelSet() == AudioChannelSet::stereo() && l.getMainInputChannelSet() == AudioChannelSet::stereo();
    }
    void processBlock (AudioBuffer<float>& buf, MidiBuffer&) override { buf.applyGain (2.0f * gain->get()); }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
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
    AudioParameterFloat* gain;
};

AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TestEffect(); }
