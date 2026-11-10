// shared header, injected synchronously so page scripts can find #admin-auth and #key-form;
// body[data-page] marks the active link, body[data-key] adds the admin key field
(() => {
  const page = document.body.dataset.page;
  const links = [
    ["monitor", "Monitor"],
    ["admin", "Keys"],
    ["upload", "Scrape"],
  ];
  const key =
    "key" in document.body.dataset
      ? `<form class="key" id="key-form">
           <input id="admin-auth" type="password" placeholder="Admin key" class="form-control form-control-sm" autocomplete="off" />
           <button id="load" class="btn btn-sm btn-primary">Load</button>
         </form>`
      : "";
  document.body.insertAdjacentHTML(
    "afterbegin",
    `<header class="topbar">
       <a class="brand" href="/monitor">scrape-ci</a>
       <nav>${links.map(([p, label]) => `<a href="/${p}"${p === page ? ' class="active"' : ""}>${label}</a>`).join("")}</nav>
       ${key}
     </header>`,
  );
})();

// local time as 2026-11-06 22:05:42; lives here because this is the one script every page loads
function formatDate(iso) {
  const d = new Date(iso ?? NaN);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
