export interface InstallEnvironmentInput {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  beforeInstallPromptSupported: boolean;
}

export interface InstallEnvironment {
  iosInstructions: boolean;
  installed: boolean;
  unsupported: boolean;
}

export function detectInstallEnvironment(input: InstallEnvironmentInput): InstallEnvironment {
  const ios = /iphone|ipad|ipod/i.test(input.userAgent);
  const ipadDesktop = input.platform === "MacIntel" && input.maxTouchPoints > 1;
  const iosInstructions = (ios || ipadDesktop) && !input.standalone;
  return {
    iosInstructions,
    installed: input.standalone,
    unsupported:
      !input.standalone && !iosInstructions && !input.beforeInstallPromptSupported,
  };
}

export interface InstallState {
  available: boolean;
  iosInstructions: boolean;
  installed: boolean;
  unsupported: boolean;
}

export interface InstallPrompt {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

/** Consomme exactement une fois l'événement natif, toujours après un clic. */
export async function consumeInstallPrompt(
  event: InstallPrompt,
): Promise<"accepted" | "dismissed"> {
  await event.prompt();
  return (await event.userChoice).outcome;
}

export function installCardState(state: InstallState): "hidden" | "ready" | "waiting" {
  if (state.installed || state.unsupported) return "hidden";
  return state.available || state.iosInstructions ? "ready" : "waiting";
}

export function shouldShowInstallBanner(state: InstallState, dismissed: boolean): boolean {
  return !dismissed && installCardState(state) === "ready";
}
