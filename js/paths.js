// URL helpers for GitHub Pages (repo subpath) and a local server (site root).

export function appBase(pathname) {
  let path = typeof pathname === "string" && pathname ? pathname : "/";
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  if (!path.endsWith("/")) path += "/";
  return path;
}

export function homePath(pathname) {
  return appBase(pathname);
}

export function hivePath(pathname) {
  return `${appBase(pathname)}?view=hive`;
}

export function launchPath(pathname) {
  return `${appBase(pathname)}?view=launch`;
}

export function tokenPath(pathname, ca) {
  return `${appBase(pathname)}?ca=${encodeURIComponent(ca)}`;
}

export function walletPath(pathname, wallet) {
  const base = appBase(pathname);
  if (!wallet) return `${base}?view=wallet`;
  return `${base}?wallet=${encodeURIComponent(wallet)}`;
}
