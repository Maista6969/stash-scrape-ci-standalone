function replaceData(data) {
  replaceShared(data)
  // simple replacement
  replaceResult(data.result?.title, 'result-title')
  replaceResult(data.result?.code, 'result-code')
  replaceResult(data.result?.director, 'result-director')
  replaceResult(data.result?.details, 'result-details')
  // complex replacements
  // one span per performer with stash-box's gender mark and colour
  const GENDER = { MALE: ["♂", "fa-mars"], FEMALE: ["♀", "fa-venus"], TRANSGENDER_MALE: ["⚧", "fa-transgender"], TRANSGENDER_FEMALE: ["⚧", "fa-transgender"] }
  for (const performer of data.result?.performers ?? []) {
    const span = document.createElement("span")
    span.className = "scene-performer"
    const [mark, cls] = GENDER[performer.gender] ?? []
    if (mark) {
      const icon = document.createElement("span")
      icon.className = cls
      icon.textContent = mark
      span.append(icon, " ")
    }
    span.append(performer.name)
    document.getElementById("result-performers").append(span)
  }
  replaceResult(data.result?.studio, "result-studio", `${data.result?.studio?.name} • ${data.result?.date}`)
  if (data.result?.duration) replaceResult(data.result?.duration, "result-duration", new Date(data.result.duration * 1000).toISOString().substring(11, 16).replace("-", ":"))

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
