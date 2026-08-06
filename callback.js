(() => {
  "use strict";

  const title = document.getElementById("title");
  const status = document.getElementById("status");
  const hint = document.getElementById("hint");
  const continueLink = document.getElementById("continue");
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error");

  if (error) {
    title.textContent = "No se autorizó la conexión";
    status.textContent = "Mercado Libre rechazó o canceló la autorización.";
    hint.textContent = "Volvé al asistente local e iniciá un nuevo intento.";
    return;
  }

  if (!code || !state) {
    status.textContent = "Este sitio recibe el retorno seguro de Mercado Libre.";
    hint.textContent = "Iniciá la conexión desde el asistente NUVELA en esta PC.";
    return;
  }

  const localCallback = new URL("http://127.0.0.1:8000/callback");
  localCallback.searchParams.set("code", code);
  localCallback.searchParams.set("state", state);

  status.textContent = "Autorización recibida. Volviendo al asistente local…";
  continueLink.href = localCallback.toString();
  continueLink.hidden = false;

  // replace evita conservar la URL de GitHub Pages con el code en el historial.
  window.location.replace(localCallback.toString());
})();
