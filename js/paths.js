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

export function tokenPath(pathname, ca) {
  return `${appBase(pathname)}?ca=${encodeURIComponent(ca)}`;
}
