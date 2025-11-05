import { env } from "./env";
import { MockBlueiotClient } from "./mockBlueiotClient";
import { RealBlueiotClient } from "./realBlueiotClient";

// Usa il client mock o reale basato sulla configurazione
export const BlueiotClient = RealBlueiotClient;
