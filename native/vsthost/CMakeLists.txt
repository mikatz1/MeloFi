cmake_minimum_required(VERSION 3.22)
project(MeloFiVstHost VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../JUCE ${CMAKE_BINARY_DIR}/JUCE)

juce_add_gui_app(MeloFiVstHost
    PRODUCT_NAME "MeloFi VST Host"
    COMPANY_NAME "MeloFi"
    VERSION 0.1.0)

target_sources(MeloFiVstHost PRIVATE Main.cpp)

target_compile_definitions(MeloFiVstHost PRIVATE
    JUCE_PLUGINHOST_VST3=1
    JUCE_PLUGINHOST_VST=0
    JUCE_PLUGINHOST_AU=0
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:MeloFiVstHost,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:MeloFiVstHost,JUCE_VERSION>")

# a tiny VST3 instrument for testing the host (not shipped)
option(MELOFI_TEST_SYNTH "Build the MeloFi Test Synth VST3" ON)
if(MELOFI_TEST_SYNTH)
    juce_add_plugin(MeloFiTestSynth
        PRODUCT_NAME "MeloFi Test Synth"
        COMPANY_NAME "MeloFi"
        PLUGIN_MANUFACTURER_CODE Melo
        PLUGIN_CODE Mtsy
        FORMATS VST3
        IS_SYNTH TRUE
        NEEDS_MIDI_INPUT TRUE
        COPY_PLUGIN_AFTER_BUILD FALSE)
    target_sources(MeloFiTestSynth PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../testsynth/TestSynth.cpp)
    target_compile_definitions(MeloFiTestSynth PUBLIC JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0)
    target_link_libraries(MeloFiTestSynth PRIVATE juce::juce_audio_utils juce::juce_recommended_config_flags)
endif()

target_link_libraries(MeloFiVstHost PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_audio_formats
    juce::juce_audio_devices
    juce::juce_gui_basics
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags)
