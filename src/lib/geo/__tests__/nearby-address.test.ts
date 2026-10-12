import { describe, expect, it } from "vitest"
import {
  findNearbyAddress,
  normalizeStreet,
  overpassQuery,
  parseOverpass,
  parseStreetAddress,
  pickNearby,
  sameStreet,
  streetKeyword,
  type MapFeature,
} from "@/lib/geo/nearby-address"

function address(number: string, street: string, latitude: number, longitude: number): MapFeature {
  return { tags: { "addr:housenumber": number, "addr:street": street }, latitude, longitude }
}

function road(tags: Readonly<Record<string, string>>, latitude: number, longitude: number): MapFeature {
  return { tags: { highway: "residential", ...tags }, latitude, longitude }
}

describe("normalizeStreet", () => {
  it("treats county road spellings as one street", () => {
    const forms = ["County Rd 41", "County Road 41", "CR 41", "Co Rd 41", "GCR 41", "Teller County Road 41", "C.R. 41"]
    expect(new Set(forms.map(normalizeStreet))).toEqual(new Set(["cr 41"]))
  })

  it("spells out common abbreviations", () => {
    expect(normalizeStreet("N Elk Ridge Dr")).toBe(normalizeStreet("North Elk Ridge Drive"))
    expect(normalizeStreet("Aspen Ct")).toBe("aspen court")
    expect(normalizeStreet("Spruce Ln")).not.toBe(normalizeStreet("Spruce Ct"))
  })
})

describe("parseStreetAddress", () => {
  it("reads the number and street from the first part", () => {
    expect(parseStreetAddress("455 Bear Creek Rd, Divide, CO 80814")).toEqual({ houseNumber: 455, street: "Bear Creek Rd" })
    expect(parseStreetAddress("12B Aspen Ct Unit 3, Fairplay")).toEqual({ houseNumber: 12, street: "Aspen Ct" })
  })

  it("skips addresses without a house number", () => {
    expect(parseStreetAddress("Lot 7 Bear Creek Rd, Divide")).toBeNull()
    expect(parseStreetAddress("Fairplay")).toBeNull()
  })
})

describe("streetKeyword", () => {
  it("picks the most specific word", () => {
    expect(streetKeyword("County Rd 41")).toBe("41")
    expect(streetKeyword("Bear Creek Rd")).toBe("creek")
    expect(streetKeyword("N Road")).toBeNull()
  })
})

describe("pickNearby", () => {
  const target = { houseNumber: 900, street: "County Rd 41" }
  const anywhere = { center: { latitude: 39, longitude: -105 }, accept: () => true }

  it("uses the closest recorded number on the same street", () => {
    const features = [
      address("300", "CR 41", 39.1, -105.1),
      address("1040", "County Road 41", 39.2, -105.2),
      address("880", "CR 410", 39.3, -105.3),
      address("905", "Elk Ln", 39.4, -105.4),
    ]
    expect(pickNearby(target, features, anywhere)).toEqual({
      latitude: 39.2,
      longitude: -105.2,
      precision: "nearby",
      label: "Near 1040 County Road 41",
    })
  })

  it("prefers the lower number on a tie", () => {
    const features = [address("1000", "CR 41", 39.2, -105.2), address("800", "CR 41", 39.1, -105.1)]
    expect(pickNearby(target, features, anywhere)?.label).toBe("Near 800 CR 41")
  })

  it("falls back to the street segment nearest the town, matched by name or road number", () => {
    const features = [
      road({ name: "County Road 41" }, 39.2, -105.2),
      road({ name: "Antelope Trail", ref: "CR 41" }, 39.01, -105.01),
      road({ name: "Antelope Trail", ref: "CR 410" }, 39.0, -105.0),
    ]
    expect(pickNearby(target, features, anywhere)).toEqual({
      latitude: 39.01,
      longitude: -105.01,
      precision: "street",
      label: "On County Rd 41 (number not found)",
    })
  })

  it("skips numbers and streets that are in another town", () => {
    const elsewhere = address("905", "CR 41", 39.5, -105.5)
    const farther = address("1400", "CR 41", 39.1, -105.1)
    const elsewhereRoad = road({ name: "CR 41" }, 39.5, -105.5)
    const notThere = { ...anywhere, accept: (latitude: number) => latitude < 39.4 }
    expect(pickNearby(target, [elsewhere, farther, elsewhereRoad], notThere)?.label).toBe("Near 1400 CR 41")
    expect(pickNearby(target, [elsewhereRoad], notThere)).toBeNull()
  })

  it("returns null when the street is not mapped", () => {
    expect(pickNearby(target, [address("900", "CR 42", 39, -105)], anywhere)).toBeNull()
  })
})

describe("overpassQuery", () => {
  it("searches addresses and streets in a box around the town", () => {
    const query = overpassQuery("41", { latitude: 39, longitude: -105 })
    expect(query).toContain(`nwr["addr:housenumber"]["addr:street"~"41",i](38.8500,-105.2000,39.1500,-104.8000);`)
    expect(query).toContain(`way["highway"]["ref"~"41",i]`)
  })
})

describe("parseOverpass", () => {
  it("reads nodes and way centers, skipping malformed elements", () => {
    const features = parseOverpass({
      elements: [
        { type: "node", lat: 39.1, lon: -105.1, tags: { "addr:housenumber": "1" } },
        { type: "way", center: { lat: 39.2, lon: -105.2 }, tags: { highway: "track", name: "X", note: 4 } },
        { type: "way", tags: { highway: "track" } },
        "junk",
      ],
    })
    expect(features).toEqual([
      { tags: { "addr:housenumber": "1" }, latitude: 39.1, longitude: -105.1 },
      { tags: { highway: "track", name: "X" }, latitude: 39.2, longitude: -105.2 },
    ])
    expect(parseOverpass(null)).toEqual([])
  })
})

describe("findNearbyAddress", () => {
  const options = { center: { latitude: 39, longitude: -105.4 }, accept: () => true }
  const answer = {
    elements: [{ type: "node", lat: 39.05, lon: -105.45, tags: { "addr:housenumber": "1000", "addr:street": "CR 41" } }],
  }

  it("queries around the town and picks from the result", async () => {
    const urls: URL[] = []
    const result = await findNearbyAddress("950 CR 41, Lake George", options, async (url) => {
      urls.push(url)
      return answer
    })
    expect(result).toEqual({
      status: "found",
      match: { latitude: 39.05, longitude: -105.45, precision: "nearby", label: "Near 1000 CR 41" },
    })
    expect(urls.map((url) => url.hostname)).toEqual(["overpass-api.de"])
  })

  it("tries the mirror when the main server is busy", async () => {
    const hosts: string[] = []
    const result = await findNearbyAddress("950 CR 41, Lake George", options, async (url) => {
      hosts.push(url.hostname)
      return hosts.length === 1 ? null : answer
    })
    expect(result.status).toBe("found")
    expect(hosts).toEqual(["overpass-api.de", "maps.mail.ru"])
  })

  it("reports unavailable, not none, when no server answers", async () => {
    expect(await findNearbyAddress("950 CR 41, Lake George", options, async () => null)).toEqual({ status: "unavailable" })
  })

  it("reports none when the street has no match", async () => {
    expect(await findNearbyAddress("950 CR 77, Lake George", options, async () => answer)).toEqual({ status: "none" })
  })

  it("does not query without a house number", async () => {
    let calls = 0
    const result = await findNearbyAddress("CR 41, Lake George", options, async () => {
      calls += 1
      return null
    })
    expect(result).toEqual({ status: "none" })
    expect(calls).toBe(0)
  })
})

describe("normalizeStreet highways", () => {
  it("treats highway spellings as one street", () => {
    const forms = ["Hwy 67", "State Highway 67", "SH 67", "Colorado Hwy 67", "Highway 67"]
    expect(new Set(forms.map(normalizeStreet))).toEqual(new Set(["highway 67"]))
  })
})

describe("sameStreet", () => {
  it("lets an address without a direction match the street with one", () => {
    expect(sameStreet("Main St", "North Main Street")).toBe(true)
    expect(sameStreet("Main St", "Main Street")).toBe(true)
  })

  it("keeps a written direction strict", () => {
    expect(sameStreet("S Main St", "North Main Street")).toBe(false)
    expect(sameStreet("N Main St", "North Main Street")).toBe(true)
    expect(sameStreet("Main St", "Main Avenue")).toBe(false)
  })
})
