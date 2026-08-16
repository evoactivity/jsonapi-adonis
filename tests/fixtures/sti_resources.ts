/**
 * The resource family for the SportsTeam STI fixtures, shared by the STI
 * spec files the way models.ts is shared.
 */
import { JsonApiRegistry } from '../../src/registry.ts'
import { JsonApiResource } from '../../src/resource.ts'
import { FootballTeam, RugbyTeam, SportsTeam } from './models.ts'

export class FootballTeamResource extends JsonApiResource<FootballTeam> {
  static type = 'football-teams'
  static model = () => FootballTeam
}

export class RugbyTeamResource extends JsonApiResource<RugbyTeam> {
  static type = 'rugby-teams'
  static model = () => RugbyTeam
}

export class SportsTeamResource extends JsonApiResource<SportsTeam> {
  static model = () => SportsTeam
  static subtypes = () => [FootballTeamResource, RugbyTeamResource]
  static resolveResource(row: SportsTeam) {
    return { football: FootballTeamResource, rugby: RugbyTeamResource }[row.sport]
  }
}

export function stiRegistry() {
  return new JsonApiRegistry().register([
    SportsTeamResource,
    FootballTeamResource,
    RugbyTeamResource,
  ])
}
