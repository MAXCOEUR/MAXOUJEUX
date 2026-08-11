import type { AnchorHTMLAttributes, ReactNode } from "react";
import { routePath, useRouteStore, type Route } from "@/lib/route";

interface LienProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: Route;
  replace?: boolean;
  children: ReactNode;
}

/**
 * Lien interne.
 *
 * C'est une **vraie** balise `<a href>` : le clic milieu ouvre un onglet, le
 * Ctrl+clic aussi, le survol affiche la destination, et le clavier la traite
 * comme un lien. Un `<div onClick>` perdrait tout cela d'un coup.
 *
 * On n'intercepte que le clic gauche sans modificateur — c'est le seul cas où la
 * navigation interne est ce que le joueur demande.
 */
export function Lien({ to, replace = false, onClick, children, ...props }: LienProps) {
  const push = useRouteStore((state) => state.push);
  const replaceRoute = useRouteStore((state) => state.replace);

  return (
    <a
      {...props}
      href={routePath(to)}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.button !== 0) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

        event.preventDefault();
        if (replace) replaceRoute(to);
        else push(to);
      }}
    >
      {children}
    </a>
  );
}
