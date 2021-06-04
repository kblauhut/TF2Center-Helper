const userDataCache = new Map();
const openRequests = [];

chrome.runtime.onConnect.addListener(port =>
	port.onMessage.addListener(msg => returnData(msg.idArray, port))
);

async function returnData(idArray, port) {
	const dataToReturn = [];

	for (const id of idArray) {
		const isCached = userDataCache.has(id);

		if (isCached) {
			dataToReturn.push({ user: userDataCache.get(id) });
			idArray.splice(idArray.indexOf(id), 1);
		}
	}

	switch (port.name) {
		case "eu": {
			const idsForRgl = [];

			for (const id of idArray) {
				let userData = await etf2lUserData(id);
				if (userData.registered === false || userData.data.division === null) {
					idsForRgl.push(id);
					continue;
				}
				dataToReturn.push(userData);
			}
			const rest = await rglUserData(idsForRgl);
			dataToReturn.push(...rest);
			break;
		}

		case "na": {
			const promises = [];
			const res = await rglUserData(idArray);

			for (const user of res)
				if (user.registered === false || user.data.division === null) {
					promises.push(etf2lUserData(id));
				}

			const fulfilled = await Promise.all(promises);
			dataToReturn.push(...fulfilled);
			break;
		}

		default: {
			const promises = [];
			const res = await rglUserData(idArray);

			for (const user of res)
				if (user.registered === false || user.data.division === null) {
					promises.push(etf2lUserData(id));
				}

			const fulfilled = await Promise.all(promises);
			dataToReturn.push(...fulfilled);
			break;
		}
	}

	for (const profile of dataToReturn) userDataCache.set(profile.id, profile);

	port.postMessage(dataToReturn);
}

// function userDataUpdated(id, userData) {
// 	for (let i = 0; i < openRequests.length; i++) {
// 		if (openRequests[i].id == id) {
// 			let port = openRequests[i].port;
// 			port.postMessage({ user: userData });
// 			openRequests.splice(i, 1);
// 			i--;
// 		}
// 	}
// }

async function request(url) {
	const headers = new Headers();
	headers.append("Accept", "application/json");
	const response = await fetch(url, {
		headers
	});
	return await response.json();
}

function etf2lUserData(id) {
	return new Promise(async resolve => {
		console.log("Getting ETF2L data for " + id);
		let userURL = "http://api.etf2l.org/player/" + id;
		let resultURL = "http://api.etf2l.org/player/" + id + "/results/1?since=0";

		let userJSON = await request(userURL);
		if (userJSON && userJSON.status.code != 404 && userJSON.status.code != 500) {
			let resultJSON = await request(resultURL);
			let name = userJSON.player.name;
			let etf2lID = userJSON.player.id;
			let team = getTeam(resultJSON);
			let division = getDiv(resultJSON);
			userData = {
				id,
				league: "etf2l",
				data: { name, team, division, etf2lID },
				registered: true
			};
		} else {
			userData = { id: id, registered: false };
		}
		resolve(userData);
	});

	function getTeam(resultJSON) {
		let clan1;
		let clan2;
		let tier;
		let category;
		if (resultJSON.results != null) {
			for (let i = 0; i < resultJSON.results.length; i++) {
				clan1 = resultJSON.results[i].clan1;
				clan2 = resultJSON.results[i].clan2;
				category = resultJSON.results[i].competition.category;
				tier = resultJSON.results[i].division.tier;
				if (category == "6v6 Season" && tier != null) {
					if (clan1.was_in_team == 1) {
						return clan1.name;
					} else if (clan2.was_in_team == 1) {
						return clan2.name;
					}
				}
			}
		}
		return null;
	}

	function getDiv(json) {
		if (!json.results) return null;

		for (const result of json.results) {
			const tier = result.division.tier;
			const tierName = result.division.name;
			const competitionName = result.competition.name;
			const category = result.competition.category;
			const clan1 = result.clan1;
			const clan2 = result.clan2;

			// This if looks like aids... I know.
			if (
				tier &&
				(category.includes("6v6 Season") ||
					(category.includes("6v6 Season") && competitionName.includes("Playoffs"))) &&
				(clan1.was_in_team == 1 || clan2.was_in_team == 1)
			) {
				switch (tierName) {
					case tierName.includes("Prem"): {
						return "etf2l_prem";
					}
					case tierName.includes("Division 1"): {
						return "etf2l_div1";
					}
					case tierName.includes("High"): {
						return "etf2l_div1";
					}
					case tierName.includes("Division 2"): {
						return "etf2l_div2";
					}
					case tierName.includes("Division 3"): {
						return "etf2l_div3";
					}
					case tierName.includes("Mid"): {
						return "etf2l_mid";
					}
					case tierName.includes("Low"): {
						return "etf2l_low";
					}
					case tierName.includes("Open"): {
						return "etf2l_open";
					}
				}
			}
		}
	}
}

function getRglDiv(profile) {
	switch (profile?.experience[0]?.div) {
		case "invite": {
			return "rgl_inv";
		}
		case "advanced": {
			return "rgl_adv";
		}
		case "main": {
			return "rgl_main";
		}
		case "intermediate": {
			return "rgl_im";
		}
		case "open": {
			return "rgl_open";
		}
		case "amateur": {
			// ?????? lol
			return "rgl_open";
		}
		case "newcomer": {
			return "rgl_new";
		}
		default: {
			return null;
		}
	}
}

async function rglUserData(profiles) {
	console.log("Getting RGL data for " + profiles.join(", "));
	// `https://rgl.payload.tf/api/v1/profiles/bulk`
	const res = await fetch("http://localhost:8080/api/v1/profiles/bulk", {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			profiles,
			formats: "sixes",
			slim: true
		})
	});

	const { data } = await res.json();

	return data.map(profile => {
		const division = getRglDiv(profile);
		console.log(`Name:${profile.name}\tDiv: ${division}`)

		return {
			id: profile.steamId,
			league: "rgl",
			data: { name: profile.name, division },
			registered: true
		};
	});
}
