function replaceData(data) {
  replaceShared(data)
  // simple replacement
  replaceResult(data.result?.title, 'result-title')
  replaceResult(data.result?.code, 'result-code')
  replaceResult(data.result?.director, 'result-director')
  replaceResult(data.result?.details, 'result-details')
  // complex replacements
  // one span per performer with stash-box's gender mark and colour
  // scrapers write gender as free text, so match like stash-box: male, female, anything else is transgender;
  // the icons are Font Awesome's mars, venus and transgender, as StashDB renders them
  const ICONS = {
    mars: { viewBox: "0 0 512 512", d: "M320 32c0-17.7 14.3-32 32-32L480 0c17.7 0 32 14.3 32 32l0 128c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-50.7-95 95c19.5 28.4 31 62.7 31 99.8 0 97.2-78.8 176-176 176S32 401.2 32 304 110.8 128 208 128c37 0 71.4 11.4 99.8 31l95-95-50.7 0c-17.7 0-32-14.3-32-32zM208 416a112 112 0 1 0 0-224 112 112 0 1 0 0 224z" },
    venus: { viewBox: "0 0 384 512", d: "M80 176a112 112 0 1 1 224 0 112 112 0 1 1 -224 0zM223.9 349.1C305.9 334.1 368 262.3 368 176 368 78.8 289.2 0 192 0S16 78.8 16 176c0 86.3 62.1 158.1 144.1 173.1-.1 1-.1 1.9-.1 2.9l0 64-32 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l32 0 0 32c0 17.7 14.3 32 32 32s32-14.3 32-32l0-32 32 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-32 0 0-64c0-1 0-1.9-.1-2.9z" },
    transgender: { viewBox: "0 0 576 512", d: "M128-32c17.7 0 32 14.3 32 32s-14.3 32-32 32L97.9 32 136 70.1 151 55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-15 15 14.2 14.2c27.9-23.8 64.2-38.2 103.8-38.2 36.7 0 70.6 12.4 97.6 33.2L466.7 32 448 32c-17.7 0-32-14.3-32-32s14.3-32 32-32l96 0c17.7 0 32 14.3 32 32l0 96c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-18.7-84.4 84.4c13 23.1 20.4 49.9 20.4 78.3 0 77.4-55 142-128 156.8l0 35.2 32 0c17.7 0 32 14.3 32 32s-14.3 32-32 32l-32 0 0 16c0 17.7-14.3 32-32 32s-32-14.3-32-32l0-16-32 0c-17.7 0-32-14.3-32-32s14.3-32 32-32l32 0 0-35.2c-73-14.8-128-79.4-128-156.8 0-31.4 9-60.7 24.7-85.4l-16.7-16.7-15 15c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l15-15-38.1-38.1 0 30.1c0 17.7-14.3 32-32 32S0 113.7 0 96L0 0C0-17.7 14.3-32 32-32l96 0zM288 336a96 96 0 1 0 0-192 96 96 0 1 0 0 192z" },
  }
  const GENDER = { male: "mars", female: "venus" }
  for (const performer of data.result?.performers ?? []) {
    const span = document.createElement("span")
    span.className = "scene-performer"
    const gender = performer.gender?.toLowerCase()
    const name = gender ? GENDER[gender] ?? "transgender" : null
    if (name) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg")
      svg.setAttribute("class", `svg-inline--fa fa-icon fa-${name}`)
      svg.setAttribute("viewBox", ICONS[name].viewBox)
      svg.setAttribute("role", "img")
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path")
      path.setAttribute("fill", "currentColor")
      path.setAttribute("d", ICONS[name].d)
      svg.append(path)
      span.append(svg, " ")
    }
    span.append(performer.name)
    document.getElementById("result-performers").append(span)
  }
  const studio = data.result?.studio
  const studioLabel = studio?.parent?.name ? `${studio.name} (of ${studio.parent.name})` : studio?.name
  replaceResult(studio, "result-studio", [studioLabel, data.result?.date].filter(Boolean).join(" • "))
  // 32:07, or 1:02:07 past an hour, as StashDB shows it
  const formatDuration = (s) => {
    const p = (n) => String(Math.floor(n)).padStart(2, "0")
    const h = Math.floor(s / 3600)
    return `${h ? `${h}:` : ""}${p((s % 3600) / 60)}:${p(s % 60)}`
  }
  if (data.result?.duration) replaceResult(data.result.duration, "result-duration", formatDuration(data.result.duration))

  for (const fact of document.querySelectorAll("[data-optional]")) {
    if (!fact.querySelector("strong, b").textContent) fact.hidden = true
  }

  // manual replacements
  // add groups
  if (data.result?.groups?.length) {
    document.getElementById("group-placeholder").remove()
    const groupContainer = document.getElementById("result-groups")
    for (const newGroup of data.result.groups) {
      const newSpan = document.createElement("span")
      newSpan.classList = "badge bg-none"
      newSpan.textContent = newGroup.name
      groupContainer.appendChild(newSpan)
    }
  }
}
// tab strip under the card; Bootstrap's CSS shows .tab-pane.active, its JS isn't loaded
for (const tab of document.querySelectorAll("#scene-tabs .nav-link")) {
  tab.addEventListener("click", () => {
    for (const t of document.querySelectorAll("#scene-tabs .nav-link")) t.classList.toggle("active", t === tab)
    for (const pane of document.querySelectorAll(".tab-content > .tab-pane")) pane.classList.toggle("active", pane.id === `tab-${tab.dataset.tab}`)
  })
}
