export type ShareOutcome = "shared" | "copied" | "cancelled";

/** Surface minimale du navigateur, injectable pour tester les deux chemins. */
export interface ShareNavigator {
  share?: (data?: ShareData) => Promise<void>;
  clipboard: Pick<Clipboard, "writeText">;
}

/** Ouvre le menu natif ou copie le même texte quand Web Share est absent. */
export async function shareText(
  title: string,
  text: string,
  browser: ShareNavigator = navigator,
): Promise<ShareOutcome> {
  if (typeof browser.share === "function") {
    try {
      await browser.share({ title, text });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  await browser.clipboard.writeText(text);
  return "copied";
}
