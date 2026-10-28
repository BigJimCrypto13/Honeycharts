// Element builder. Children that are strings become text nodes, never HTML.

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text != null) node.textContent = String(props.text);
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(key, String(value));
    }
  }
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      node.addEventListener(type, handler);
    }
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child == null || child === false) continue;
    if (typeof child === "string" || typeof child === "number") {
      node.append(document.createTextNode(String(child)));
    } else {
      node.append(child);
    }
  }
  return node;
}

export function externalLink(href, label, className) {
  const link = el("a", {
    className: className || "text-link",
    text: label,
    attrs: {
      href,
      target: "_blank",
      rel: "noopener noreferrer",
    },
  });
  return link;
}
