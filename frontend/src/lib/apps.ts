
export interface AppEntry {
  id: "comfyui";
  name: string;
  author: string;
  description: string;
  tags: string[];
  homepage: string;
  license: string;
  colors: [string, string];
}

export const APPS: readonly AppEntry[] = [
  {
    id: "comfyui",
    name: "ComfyUI",
    author: "Comfy Org",
    description:
      "Węzłowy edytor do generowania obrazów, wideo, audio i 3D (Stable Diffusion, SDXL, FLUX, Wan, ACE-Step i inne). Instalowany automatycznie razem z ComfyUI-Manager.",
    tags: ["Obraz", "Wideo", "Audio", "Węzły"],
    homepage: "https://www.comfy.org",
    license: "GPL-3.0",
    colors: ["#f59e0b", "#7c3aed"],
  },
];

export interface PlannedApp {
  id: string;
  name: string;
  description: string;

  icon: string;
}

export const PLANNED_APPS: readonly PlannedApp[] = [
  {
    id: "open-webui",
    name: "Open WebUI",
    description: "Czat z dokumentami, wyszukiwaniem w sieci i narzędziami. Korzystałby z modeli, które masz w Katalogu.",
    icon: "M4 5h16v11H9l-5 4z M8 9h8 M8 12h5",
  },
  {
    id: "invokeai",
    name: "InvokeAI",
    description: "Edytor obrazów z retuszem, rozszerzaniem kadru i warstwami.",
    icon: "M4 4h16v16H4z M4 15l5-5 4 4 3-3 4 4 M15 8h.01",
  },
];

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function appBanner(app: AppEntry): string {
  const [from, to] = app.colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 300" width="800" height="300">
  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
  </linearGradient></defs>
  <rect width="800" height="300" fill="url(#g)"/>
  <g fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="4">
    <rect x="470" y="60" width="120" height="70" rx="12"/><rect x="620" y="150" width="120" height="70" rx="12"/>
    <rect x="470" y="190" width="120" height="70" rx="12"/>
    <path d="M590 95 C 610 95, 600 185, 620 185"/><path d="M590 225 C 610 225, 600 185, 620 185"/>
  </g>
  <text x="48" y="170" font-family="system-ui, sans-serif" font-size="56" font-weight="800" fill="#fff">${escapeXml(app.name)}</text>
</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
