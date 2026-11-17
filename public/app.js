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

const booksForm = document.querySelector("#books-search");
if (booksForm) {
  const input = document.querySelector("#books-q");
  const status = document.querySelector("#books-status");
  const suggest = document.querySelector("#books-suggest");
  const tbody = document.querySelector("#books-rows");
  const count = document.querySelector("#books-count");
  const pager = document.querySelector("#books-pager");
  let timer = 0;
  let active = -1;

  function moneyCell(label) {
    return label || "—";
  }

  function renderRows(payload) {
    tbody.replaceChildren();
    if (!payload.rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 6;
      td.textContent = "No items match this search.";
      tr.appendChild(td);
      tbody.appendChild(tr);
    }
    for (const row of payload.rows) {
      const tr = document.createElement("tr");
      const name = document.createElement("td");
      const link = document.createElement("a");
      link.href = `/books-items/${encodeURIComponent(row.item_id)}`;
      link.textContent = row.name;
      name.appendChild(link);
      const cells = [row.sku || "—", row.part_number || "—", moneyCell(row.rate_label), row.unit || "—", row.status || "—"];
      tr.appendChild(name);
      cells.forEach((text, index) => {
        const td = document.createElement("td");
        td.textContent = text;
        if (index === 4 && row.status === "inactive") td.className = "muted";
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    const start = payload.rows.length ? (payload.page - 1) * payload.pageSize + 1 : 0;
    const end = payload.rows.length ? start + payload.rows.length - 1 : 0;
    count.textContent = `Showing ${start ? start + "–" + end : "0"} of ${payload.total}${payload.q ? ` for “${payload.q}”` : ""}`;
    pager.replaceChildren();
    const params = new URLSearchParams({ q: payload.q, status: payload.status });
    if (payload.page > 1) {
      params.set("page", String(payload.page - 1));
      const prev = document.createElement("a");
      prev.className = "btn";
      prev.href = `/books-items?${params}`;
      prev.textContent = "Previous";
      pager.appendChild(prev);
    }
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = `Page ${payload.page} of ${payload.pages}`;
    pager.appendChild(label);
    if (payload.page < payload.pages) {
      params.set("page", String(payload.page + 1));
      const next = document.createElement("a");
      next.className = "btn";
      next.href = `/books-items?${params}`;
      next.textContent = "Next";
      pager.appendChild(next);
    }
    const url = new URLSearchParams({ q: payload.q, status: payload.status, page: String(payload.page) });
    history.replaceState(null, "", `/books-items?${url}`);
  }

  function renderSuggest(rows) {
    suggest.replaceChildren();
    active = -1;
    if (!input.value.trim()) {
      suggest.hidden = true;
      return;
    }
    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No matching items";
      suggest.appendChild(empty);
      suggest.hidden = false;
      return;
    }
    for (const row of rows) {
      const link = document.createElement("a");
      link.href = `/books-items/${encodeURIComponent(row.item_id)}`;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = row.name;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = [row.sku, row.part_number].filter(Boolean).join(" · ");
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = row.rate || "";
      link.append(name, meta, price);
      suggest.appendChild(link);
    }
    suggest.hidden = false;
  }

  async function refresh(page) {
    const params = new URLSearchParams({
      q: input.value,
      status: status.value,
      page: String(page || 1),
    });
    const [list, hints] = await Promise.all([
      fetch(`/books-items/search?${params}`).then((res) => res.json()),
      input.value.trim()
        ? fetch(`/books-items/suggest?q=${encodeURIComponent(input.value)}&status=${encodeURIComponent(status.value)}`).then((res) => res.json())
        : Promise.resolve({ rows: [] }),
    ]);
    renderRows(list);
    renderSuggest(hints.rows || []);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => refresh(1), 80);
  });
  status.addEventListener("change", () => refresh(1));
  booksForm.addEventListener("submit", (event) => {
    event.preventDefault();
    suggest.hidden = true;
    refresh(1);
  });
  input.addEventListener("keydown", (event) => {
    const links = [...suggest.querySelectorAll("a")];
    if (event.key === "Escape") {
      suggest.hidden = true;
      return;
    }
    if (!links.length || suggest.hidden) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active = event.key === "ArrowDown" ? Math.min(active + 1, links.length - 1) : Math.max(active - 1, 0);
      links.forEach((link, index) => link.classList.toggle("active", index === active));
      links[active].scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter" && active >= 0) {
      event.preventDefault();
      window.location = links[active].href;
    }
  });
  document.addEventListener("click", (event) => {
    if (!booksForm.contains(event.target)) suggest.hidden = true;
  });
}

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
