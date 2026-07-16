const deploymentId = process.env.NEXT_PUBLIC_VERCEL_DEPLOYMENT_ID ?? "";

export function deploymentPinnedUrl(input: string, currentDeploymentId = deploymentId) {
  if (!currentDeploymentId) return input;

  const url = new URL(input, "https://finance-panel.local");
  url.searchParams.set("dpl", currentDeploymentId);

  if (/^https?:\/\//i.test(input)) return url.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function deploymentPinnedFetch(input: string, init?: RequestInit) {
  return fetch(deploymentPinnedUrl(input), init);
}
