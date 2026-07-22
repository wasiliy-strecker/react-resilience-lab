export function formatIncidentEtag(
  incidentId: string,
  version: number,
): string {
  return `"${incidentId}-v${version}"`
}
