import { Config } from "@remotion/cli/config";

// Stills and the master are PNG-sequenced then encoded once; JPEG frames band on the dark gradients.
Config.setVideoImageFormat("png");
Config.setPixelFormat("yuv420p");
Config.setCodec("h264");
// A laptop-class machine (6 cores, 15 GB) stays responsive at half its threads.
Config.setConcurrency(6);
Config.setChromiumOpenGlRenderer("angle");
