// The privacy and terms page is static; this only wires the light and dark switch.
import { theme } from "./lib.js";

const th = theme();
document.getElementById("theme").addEventListener("click", () => th.toggle());
