# City global facade audit

The two live graphics reports supplied on 2026-11-11 were compared with a CPU replay of the original City and City2 assets through the actual Viewer material/geometry preparation and GlobalFacadeBatches compiler. Texture-array GPU copies are replaced by identity/dimension bookkeeping; no GPU timings or camera draw counts are simulated.

Replay totals exactly match both live reports: **363 source parts, 3,526 part copies, 45 global batches, 721,020 triangles, 85.48 MiB of geometry buffers, 45 shared texture arrays**. No preparation warnings. This agreement, plus matching numbered triangle counts below, identifies the reported batches. IDs are specific to this installed asset set and preparation order.

## What the distant houses are

The small detached houses are `objects/meshes/krthazNN/krthazNN.scx`, `NN=01..20`, selected via `objects.rpk` render resources. The source SCX files describe individual houses. Global facade compilation expands placements and combines the unified opaque geometry for each house type across City/City2. Different texture/colour variants of that type join the same array-material batch.

There are **656 house geometry placements in 20 global batches (#25–44), with 251,687 triangles in total**. Each resulting batch has one geometry, one material and one identity instance: at most one main-colour draw per batch per frame. Shadows and depth captures are separate passes. This excludes any retained transparent/non-unified components.

Examples actually present in the first report’s measured main-colour draws:

| Batch | Source | Copies across map | Triangles | Main-colour draws |
|---|---|---:|---:|---:|
|26|krthaz04|76|30,020|1|
|29|krthaz18|79|38,473|1|
|31|krthaz20|59|24,780|1|

Their world bounds extend about 1.8 km across. The streamer tests the complete batch bounds; GlobalFacadeBatches.update has no per-placement distance compaction. An intersecting batch submits all of its copies. These are not hundreds of individual distant draw calls, and not originally one district-wide SCX mesh: the global merge is performed by this renderer.

## Live views

| Metric | Looking towards houses | Camera on car/road |
|---|---:|---:|
|Global batches marked primary-visible, before final Hi-Z verdicts|39|20|
|Actual main-colour mesh draws|499|236|
|Actual main-colour triangles submitted|921,940|613,905|
|Render CPU indicator|10.8 ms|6.3 ms|

The first report’s main-colour totals sum opaque/cutout/blend: 343+26+130 draws. The second sums 174+10+52. Dynamic shadow draws (157 and 125) are excluded from this comparison. The hierarchy’s 39/20 batch counts are not substituted for a measured global-facade-only draw total: the report lists only the ten heaviest mesh groups.

The road view still explicitly draws facade batches **1, 8, 12, 0, 10, 6, 3, 7**: eight measured draws and **304,191 triangles**, about 49.6% of all submitted main-colour triangles in that frame. These are storefront/frontage types; their common bounds cover much of the city even when the individual facade fragments are behind the camera. The views also differ in trees/props, so the CPU difference cannot be attributed solely to global facades. Submitted triangles are not visible pixels or a GPU time measurement.

## Complete compiler mapping

Copies below count source-part placements, not necessarily unique complete buildings: some storefront models contribute to more than one material batch. Bounds are horizontal X × Z extents in metres.

| Batch | Source aliases | Part copies | Triangles | Bounds X × Z, m |
|---|---|---:|---:|---:|
|0|03x6_ajto|514|40,092|2143 × 2223|
|1|06p5x6_lepcsosboltiv|263|60,490|2093 × 2220|
|2|06x4_pub|69|10,212|2019 × 1774|
|3|06x5_shop, 23x5_shop|122|23,768|1983 × 2176|
|4|06x7_2ajtos|79|19,750|1978 × 2198|
|5|08p5x4_shop|218|22,236|2085 × 2185|
|6|09x6_shop|186|34,968|2124 × 2185|
|7|12p5x6_lepcsos, 13p5x6_alap, 13x6_ajto, 14x6_ketszintajtos, 22x4_pub, 23x5_shop, 24x5_beugro|505|23,346|2082 × 2206|
|8|12p5x6_lepcsos|159|44,997|2132 × 2153|
|9|13x6_ajto|102|11,628|2136 × 1880|
|10|14x6_ketszintajtos|134|36,180|1982 × 2205|
|11|15x9_shop|44|12,584|1714 × 843|
|12|18x6_haromboltiv|75|40,350|1818 × 2147|
|13|19x6_garazs|98|20,972|2061 × 1795|
|14|21x6_lepcsosboltiv|52|19,084|1970 × 2107|
|15|22x4_pub|44|11,440|1947 × 2163|
|16|12x6_redonyos, 20x6_redonyos|80|10,080|2085 × 2160|
|17|12x6_uveges|34|3,740|1988 × 1777|
|18|12x6_ketszintteraszos|51|14,790|1958 × 1652|
|19|24x5_beugro|36|5,904|1914 × 2193|
|20|hotel_001_egyedi|1|201|70 × 75|
|21|hotel_005_egyedi|1|160|135 × 120|
|22|hotel_007_egyedi|1|639|109 × 108|
|23|hotel_013_egyedi|1|790|132 × 146|
|24|hotel_003_egyedi|1|932|54 × 130|
|25|krthaz03|42|11,088|1817 × 806|
|26|krthaz04|76|30,020|1816 × 806|
|27|krthaz10|58|14,500|1795 × 780|
|28|krthaz13|48|13,392|1852 × 739|
|29|krthaz18|79|38,473|1844 × 729|
|30|krthaz19|34|16,252|1849 × 730|
|31|krthaz20|59|24,780|1792 × 695|
|32|krthaz05|17|6,800|1766 × 720|
|33|krthaz06|19|6,061|1886 × 934|
|34|krthaz08|22|11,418|1969 × 918|
|35|krthaz14|35|11,620|1942 × 879|
|36|krthaz15|18|6,120|1798 × 903|
|37|krthaz16|23|8,809|1908 × 923|
|38|krthaz09|33|17,589|1762 × 782|
|39|krthaz11|32|10,176|1813 × 735|
|40|krthaz01|17|5,151|1723 × 864|
|41|krthaz07|24|12,600|1975 × 993|
|42|krthaz17|2|992|541 × 542|
|43|krthaz02|5|1,595|964 × 474|
|44|krthaz12|13|4,251|1660 × 691|

## Reproduce

Run `node --import tsx tools/audit-city-facades.ts` against the installed game (`SLRR_GAME_ROOT` can select another installation). The default output is [reports/city-facade-batches.json](reports/city-facade-batches.json). An optional first argument selects another output path. The JSON retains RPK render IDs, source SCX paths and per-batch contributions.

Batch contribution metadata is captured only during compilation; it does not add per-frame scene scans or geometry changes. No culling or rendering policy was changed by this audit.
