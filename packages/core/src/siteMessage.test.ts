import { describe, expect, it } from "vitest";
import { mapsUrl, parseCoordinates, siteWhatsAppText, type SiteDetails } from "./siteMessage.js";

const site: SiteDetails = {
  code: "0H31DE",
  siteName: "BH-QMB-LOQIN",
  office: "KAFR EL DAWAR",
  nodality: "1+2",
  vip: true,
  siteType: "Green Field",
  powerSource: "EC+DG",
  battery: "YES",
  phone: "01012345678 / 01198765432",
  location: "31.0412, 30.4702",
  region: "DE",
  notes: null,
};

describe("site message", () => {
  it("parses coordinates and builds map links", () => {
    expect(parseCoordinates("31.0412, 30.4702")).toEqual([31.0412, 30.4702]);
    expect(parseCoordinates("31.0412 30.4702")).toEqual([31.0412, 30.4702]);
    expect(parseCoordinates("Kafr El Dawar, Main St")).toBeNull();
    expect(parseCoordinates("95, 30")).toBeNull();
    expect(mapsUrl("31.0412, 30.4702")).toBe(
      "https://www.google.com/maps/search/?api=1&query=31.0412%2C30.4702",
    );
    expect(mapsUrl("https://maps.app.goo.gl/abc")).toBe("https://maps.app.goo.gl/abc");
    expect(mapsUrl("")).toBeNull();
  });

  it("formats a WhatsApp message, one detail per line, empty fields left out", () => {
    expect(siteWhatsAppText(site)).toBe(
      [
        "*Site 0H31DE* — BH-QMB-LOQIN",
        "🏢 Office: KAFR EL DAWAR",
        "📍 Region: DE",
        "⭐ VIP: YES",
        "🔗 Nodality: 1+2 (nodal)",
        "🏗️ Site type: Green Field",
        "⚡ Power: EC+DG (generator)",
        "🔋 Battery: YES",
        "📞 Guard: 01012345678 / 01198765432",
        "🗺️ Location: 31.0412, 30.4702",
        "https://www.google.com/maps/search/?api=1&query=31.0412%2C30.4702",
      ].join("\n"),
    );
    const bare = siteWhatsAppText({
      ...site,
      siteName: null,
      vip: false,
      nodality: "1+0",
      siteType: null,
      powerSource: "EC",
      battery: null,
      phone: null,
      location: null,
      region: null,
    });
    expect(bare).toBe(
      ["*Site 0H31DE*", "🏢 Office: KAFR EL DAWAR", "🔗 Nodality: 1+0", "⚡ Power: EC"].join("\n"),
    );
  });
});
