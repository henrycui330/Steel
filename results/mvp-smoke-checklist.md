# Manual smoke checklist — Steel MVP + fire + Sherman

Date: 2026-09-05  
URL: http://127.0.0.1:5173/ (or bridge http://localhost:9222)

## Checklist

- [ ] Page loads; dark sky + green ground + brown walls visible
- [ ] Sherman-style tank visible at spawn (procedural unless `sherman.glb` present)
- [ ] WASD / arrows: drive and turn work
- [ ] Releasing keys stops the tank (no coast)
- [ ] Camera follows behind the tank while driving
- [ ] Driving into a wall stops the tank; cannot leave the arena
- [ ] Space fires a yellow shell from the barrel
- [ ] Holding Space respects ~0.5s cooldown (not a continuous stream)
- [ ] Shell disappears at wall or after ~2s
- [ ] Browser console: `[Steel] Sherman + fire...` (and optionally Sherman GLB load / fallback warn); no errors

## Notes

_(fill after manual test)_

Metaworldos Sherman not vendored: proprietary label + 404 on public path.
