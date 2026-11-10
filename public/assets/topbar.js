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
