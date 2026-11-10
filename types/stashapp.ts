export type installedPackage = {
  package_id: string
  version: string
  date: string
  // the version currently in the remote index, null if the index no longer lists the package
  source_package: { version: string, date: string } | null
}

export type logEntry = {
  time: string,
  level: "Trace" | "Debug" | "Info" | "Warning" | "Error",
  message: string
}