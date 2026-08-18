export function isAllowedSocketOrigin(
  origin: string | undefined,
  publicOrigin: string,
): boolean {
  if (!origin) return false;
  return origin === new URL(publicOrigin).origin;
}

export function socketClientIp(
  forwardedFor: string | string[] | undefined,
  directAddress: string,
  trustedProxyHops: number,
): string {
  if (trustedProxyHops <= 0 || typeof forwardedFor !== "string") return directAddress;
  const chain = [
    ...forwardedFor.split(",").map((value) => value.trim()).filter(Boolean),
    directAddress,
  ];
  return chain[Math.max(0, chain.length - trustedProxyHops - 1)] ?? directAddress;
}
