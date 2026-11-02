function copyWithSelection(text) {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, area.value.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

document.querySelectorAll("[data-copy]").forEach((el) => {
  el.addEventListener("click", async () => {
    const text = el.getAttribute("data-copy") || "";
    let copied = false;
    const framed = window.self !== window.top;
    if (!framed && navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        copied = false;
      }
    }
    if (!copied) copied = copyWithSelection(text);
    if (!copied) return;
    const note = el.querySelector("small");
    if (!note) return;
    const old = note.textContent;
    note.textContent = "Copied";
    setTimeout(() => {
      note.textContent = old;
    }, 1600);
  });
});

document.querySelectorAll("[data-add-row]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const table = document.querySelector(btn.getAttribute("data-add-row"));
    const body = table && table.querySelector("tbody");
    if (!body) return;
    const row = body.querySelector("tr");
    const next = row ? row.cloneNode(true) : null;
    if (!next) return;
    next.querySelectorAll("input").forEach((input) => {
      if (input.type === "checkbox") {
        input.checked = false;
        return;
      }
      input.value = input.name === "order" ? String(body.querySelectorAll("tr").length + 1) : "";
    });
    body.appendChild(next);
  });
});

document.querySelectorAll("[data-remove-row]").forEach((table) => {
  table.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-remove]");
    if (!btn) return;
    const row = btn.closest("tr");
    const body = table.querySelector("tbody");
    if (row && body && body.querySelectorAll("tr").length > 1) row.remove();
    else if (row) row.querySelectorAll("input").forEach((input) => { input.value = ""; });
  });
});
