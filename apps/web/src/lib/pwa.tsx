import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { consumeInstallPrompt, detectInstallEnvironment, type InstallPrompt } from "./pwa-install";

interface BeforeInstallPromptEvent extends Event, InstallPrompt {}

interface PwaController {
  available: boolean;
  iosInstructions: boolean;
  installed: boolean;
  unsupported: boolean;
  needRefresh: boolean;
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
  update: () => Promise<void>;
}

const PwaContext = createContext<PwaController | null>(null);

function standalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

export function PwaProvider({ children }: { children: ReactNode }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(() => standalone());
  const environment = useMemo(
    () =>
      detectInstallEnvironment({
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        maxTouchPoints: navigator.maxTouchPoints,
        standalone: installed,
        beforeInstallPromptSupported: "onbeforeinstallprompt" in window,
      }),
    [installed],
  );
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const appInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!promptEvent) return "unavailable" as const;
    const outcome = await consumeInstallPrompt(promptEvent);
    setPromptEvent(null);
    return outcome;
  }, [promptEvent]);

  const value = useMemo<PwaController>(
    () => ({
      available: promptEvent !== null,
      iosInstructions: environment.iosInstructions,
      installed: installed || environment.installed,
      unsupported: environment.unsupported,
      needRefresh,
      install,
      update: () => updateServiceWorker(true),
    }),
    [environment, install, installed, needRefresh, promptEvent, updateServiceWorker],
  );

  return <PwaContext.Provider value={value}>{children}</PwaContext.Provider>;
}

export function usePwa(): PwaController {
  const value = useContext(PwaContext);
  if (!value) throw new Error("usePwa doit être utilisé dans PwaProvider");
  return value;
}
