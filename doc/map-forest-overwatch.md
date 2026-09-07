# Map 1 — Forest Overwatch

**Size:** 150 × 150  
**Spawn:** center `(0, 0, 0)`  
**Dummy:** AI Pz-III at `(0, 0, 58)`, faces south, hunts player  

## Layout

| Zone | Contents |
| --- | --- |
| Clearing | Open center + north corridor for drive / LOS |
| Forest belts | Pine clusters along arena edges + light interior clumps |
| Cover | Rock groups mid-field (visual only) |
| Overwatch ridge | Cliffs + tall rocks on the north shelf behind the dummy |
| Approach | Stone path tiles from spawn toward the dummy |
| Clutter | Bushes, stumps, logs near tree lines |

## Tech

- Module: `code/src/maps/forestOverwatch.ts`
- Collision: `code/src/collision.ts` — XZ cylinders for trees (trunk), rocks, cliffs, stumps, logs; bushes + path are soft
- Assets: Kenney Nature Kit GLB + Prototype Green ground tile (CC0)
- Perimeter walls still clamp the tank

## Smoke-test

1. Menu shows forested arena behind UI  
2. Deploy → drive north along path toward dummy  
3. Drive into a tree / rock / cliff — tank should stop / slide, not pass through  
4. Shells hit rocks/cliffs (and low trunk); lofted shots can clear canopy  
5. Walls still stop exit at ±~75  
