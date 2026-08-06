# Data sources and attribution

## Airfoil coordinates

The primary catalog source is the **UIUC Airfoil Coordinates Database**, maintained by Michael Selig at the University of Illinois Urbana-Champaign. The browser-side full-index discovery uses a public GitHub mirror containing Selig-format coordinate files so the static app can enumerate entries through a CORS-accessible JSON API.

Each detail page links back to the UIUC source and the coordinate file. The included catalog builder can read the official UIUC index directly.

## Low-speed experimental data

The UIUC Low-Speed Airfoil Tests program is a relevant source for measured polars on selected low-Reynolds-number sections. The present release links to external specification/polar resources but does not bundle or normalize the complete experimental polar collection, because polar results must retain Reynolds number, transition/roughness, turbulence, and test-method context.

## AirfoilTools

Detail pages include convenience links to AirfoilTools records when an identifier follows the site’s conventional slug format. Those pages are external and may not exist for every catalog identifier.

## Derived values

Thickness, camber, their positions, trailing-edge thickness, and approximate symmetry are computed from normalized coordinate geometry. These are not copied specification values.

Family, speed, altitude, use-case, and recommended-Reynolds labels are broad heuristics. The interface labels them as algorithmic recommendations and should not represent them as experimentally verified operating envelopes.
