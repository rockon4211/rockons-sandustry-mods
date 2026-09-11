
// =========================================================================
// MANUFACTURING & GLASS research
//
// Manufacturing sits immediately LEFT of the Smelter in the tech tree
// (Smelter is grid row 13, col 1 - verified in the vanilla layout table),
// and is the trunk future branches will hang off. GLASS is its first
// child: researching it registers the Sand -> Glass smelter recipe, which
// does not exist until then - un-researched, the Smelter ignores Sand.
// =========================================================================

const TECH_MANU = "brandonManufacturing";
const TECH_GLASS = "brandonGlassTech";

safe(() => api.i18n.register("en", {
	[`tech|${TECH_MANU}|name`]: "Manufacturing",
	[`tech|${TECH_MANU}|description`]:
		"Industrial processing of raw desert materials. Unlocks the manufacturing branch - Glass first, more to come.",
	[`tech|${TECH_GLASS}|name`]: "Glass",
	[`tech|${TECH_GLASS}|description`]:
		"Glassmaking. The Smelter learns to convert Sand 1:1 into Glass, a pale solid just light enough to clear the machine.",
}));

// Manufacturing - left of the Smelter (row 13, col 0), child of Smelter tech.
{
	const parent = safe(() => sandkit.enums.Tech.Smelter);
	if (parent !== undefined && parent !== null && !safe(() => api.tech.getDefinitionById(TECH_MANU))) {
		const definition = {
			nameKey: `tech|${TECH_MANU}|name`,
			descriptionKey: `tech|${TECH_MANU}|description`,
			cost: 250,
			currencyType: "gold",
			branch: "heat",
			requires: [parent],
			unlocks: {},
		};
		let done = false;
		for (const preferredPosition of [{ row: 13, col: 0 }, { row: 14, col: 1 }, { row: 12, col: 0 }, null]) {
			try {
				api.tech.registerNode(TECH_MANU, definition,
					preferredPosition ? { parentId: parent, preferredPosition } : { parentId: parent });
				console.log(`[${MOD_ID}] research node registered: Manufacturing (left of the Smelter)`);
				done = true;
				break;
			} catch (e) {
				if (/already registered/i.test(String(e && e.message))) { done = true; break; }
			}
		}
		if (!done) console.error(`[${MOD_ID}] Manufacturing node could not be placed`);
	}
}

// Glass - first branch under Manufacturing (row 14, col 0).
{
	if (safe(() => api.tech.getDefinitionById(TECH_MANU)) && !safe(() => api.tech.getDefinitionById(TECH_GLASS))) {
		const definition = {
			nameKey: `tech|${TECH_GLASS}|name`,
			descriptionKey: `tech|${TECH_GLASS}|description`,
			cost: 500,
			currencyType: "gold",
			branch: "heat",
			requires: [TECH_MANU],
			unlocks: {},
		};
		let done = false;
		for (const preferredPosition of [{ row: 14, col: 0 }, { row: 15, col: 0 }, { row: 15, col: 1 }, null]) {
			try {
				api.tech.registerNode(TECH_GLASS, definition,
					preferredPosition ? { parentId: TECH_MANU, preferredPosition } : { parentId: TECH_MANU });
				console.log(`[${MOD_ID}] research node registered: Glass (under Manufacturing)`);
				done = true;
				break;
			} catch (e) {
				if (/already registered/i.test(String(e && e.message))) { done = true; break; }
			}
		}
		if (!done) console.error(`[${MOD_ID}] Glass node could not be placed`);
	}
}

// The gated recipe: the Smelter learns Sand -> Glass only once GLASS is
// researched. Recipe registration is dynamic (the registry broadcasts to the
// sim threads), so a light poll arms it the moment the node unlocks - this
// session or any later one.
let glassRecipeArmed = false;
function armGlassRecipe() {
	if (glassRecipeArmed || !isEnabled()) return;
	if (safe(() => api.tech.isLockedById(TECH_GLASS)) !== false) return;
	const input = typeOf("Sand"), output = typeOf("glass");
	if (input === undefined || output === undefined) return;
	try {
		api.structures.recipes.register("smelter", { input, outputs: [{ elementType: output, chance: 1 }] });
		safe(() => api.elements.addInteractionInfo("Sand", { kind: "custom", text: "Smelter: Sand → Glass" }));
		safe(() => api.ui.toast("Glass researched - the Smelter now converts Sand into Glass"));
		console.log(`[${MOD_ID}] Glass researched: smelter recipe Sand -> Glass armed`);
	} catch (e) {
		console.error(`[${MOD_ID}] gated glass recipe failed to register:`, e);
	}
	glassRecipeArmed = true;
}
armGlassRecipe();
setInterval(armGlassRecipe, 1500);
