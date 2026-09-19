import type { TeamId } from './nations'
import type { TankId } from './tankCatalog'

export type ScoreRow = {
  id: string
  name: string
  tankId: TankId
  tankName: string
  team: TeamId
  isPlayer: boolean
  kills: number
  deaths: number
}

export type MatchScoreboard = {
  register: (opts: {
    id: string
    name: string
    tankId: TankId
    tankName: string
    team: TeamId
    isPlayer?: boolean
    root: { uuid: string }
  }) => void
  /** Credit a kill to the shooter (by root uuid). */
  noteKill: (killerRoot: { uuid: string }) => void
  /** +1 death for the victim (by root uuid). */
  noteDeath: (victimRoot: { uuid: string }) => void
  noteKillById: (id: string) => void
  noteDeathById: (id: string) => void
  /** Current kill count for the registered player row (0 if none). */
  playerKills: () => number
  /**
   * Fires when the *player* is credited a kill (destruction callback → noteKill).
   * Returns unsubscribe.
   */
  onPlayerKill: (fn: (kills: number) => void) => () => void
  /** Sorted leaderboard: kills desc, deaths asc, player first on ties. */
  ranked: () => ScoreRow[]
}

/** In-match kill / death board for podium + leaderboard. */
export function createMatchScoreboard(): MatchScoreboard {
  const byId = new Map<string, ScoreRow>()
  const rootToId = new Map<string, string>()
  const playerKillFns = new Set<(kills: number) => void>()

  function bumpKill(id: string): void {
    const row = byId.get(id)
    if (!row) return
    row.kills += 1
    if (row.isPlayer) {
      for (const fn of playerKillFns) fn(row.kills)
    }
  }

  function bumpDeath(id: string): void {
    const row = byId.get(id)
    if (!row) return
    row.deaths += 1
  }

  return {
    register({ id, name, tankId, tankName, team, isPlayer = false, root }) {
      byId.set(id, {
        id,
        name,
        tankId,
        tankName,
        team,
        isPlayer,
        kills: 0,
        deaths: 0,
      })
      rootToId.set(root.uuid, id)
    },
    noteKill(killerRoot) {
      const id = rootToId.get(killerRoot.uuid)
      if (id) bumpKill(id)
    },
    noteDeath(victimRoot) {
      const id = rootToId.get(victimRoot.uuid)
      if (id) bumpDeath(id)
    },
    noteKillById(id) {
      bumpKill(id)
    },
    noteDeathById(id) {
      bumpDeath(id)
    },
    playerKills() {
      for (const row of byId.values()) {
        if (row.isPlayer) return row.kills
      }
      return 0
    },
    onPlayerKill(fn) {
      playerKillFns.add(fn)
      return () => {
        playerKillFns.delete(fn)
      }
    },
    ranked() {
      return [...byId.values()].sort((a, b) => {
        if (b.kills !== a.kills) return b.kills - a.kills
        if (a.deaths !== b.deaths) return a.deaths - b.deaths
        if (a.isPlayer !== b.isPlayer) return a.isPlayer ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    },
  }
}

export function formatKd(kills: number, deaths: number): string {
  if (deaths <= 0) return kills === 0 ? '0.00' : kills.toFixed(2)
  return (kills / deaths).toFixed(2)
}
