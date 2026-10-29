import { describe, expect, it } from "vitest";
import { hasUpdateText, mailLine, officeTitle, updateText, whatsappTextUrl } from "./sendUpdate.js";
import { normalizeUiPrefs } from "./uiPrefs.js";

const L = "‎";

describe("send update", () => {
  it("office, Teams list, notes, then the clears — every line left-to-right", () => {
    const clear =
      "CLEARED_S_D_N_SHELTER DOO on #SRAN_LWG_S_BH-KFDW-ENT_3650DE# at |28-OCT-2026 19:00:09 |";
    const parts = {
      bullets: ["team in way to LNG", "  ", "team at Media Rashid"],
      notes: "  check matmir7\n",
      mails: [clear],
    };
    expect(updateText("Kafr ElDawar", "28 Oct, 19:10", parts)).toBe(
      `${L}*Kafr ElDawar* · 28 Oct, 19:10\n\n` +
        `${L}*Teams*\n${L}- team in way to LNG\n${L}- team at Media Rashid\n\n` +
        `${L}check matmir7\n\n` +
        `${L}*Cleared (1)*\n${L}✅ SHELTER DOO — BH-KFDW-ENT_3650DE`,
    );
    expect(
      updateText(
        "Tanta",
        "",
        { bullets: [], notes: "", mails: [clear] },
        { mails: "Alarms", icon: "🔴" },
      ),
    ).toBe(`${L}*Tanta*\n\n${L}*Alarms (1)*\n${L}🔴 SHELTER DOO — BH-KFDW-ENT_3650DE`);
    expect(updateText("", "", { bullets: [], notes: "", mails: [] })).toBe("");
  });

  it("mail subject → one short line", () => {
    expect(
      mailLine(
        "CLEARED_S_D_N_NE3SWS AGENT NOT RESPONDING TO REQUESTS on #SRAN_LWG_TDD_S_BH-MALQA_4244DE#",
      ),
    ).toBe("NE3SWS AGENT NOT RESPONDING TO REQUESTS — BH-MALQA_4244DE");
    expect(mailLine("D_S_BTS DOWN;Default System Time on #451_S_X_0D36DE# at |x|")).toBe(
      "BTS DOWN — X_0D36DE",
    );
    expect(mailLine("Huawei Alram Notify New alarm: A/B/Major")).toBe(
      "Huawei Alram Notify New alarm: A/B/Major",
    );
  });

  it("knows when there is text", () => {
    expect(hasUpdateText({ bullets: [" "], notes: "", mails: [] })).toBe(false);
    expect(hasUpdateText({ bullets: [], notes: " x ", mails: [] })).toBe(true);
  });

  it("pre-fills the text for a number or the chat list, not for a group", () => {
    expect(whatsappTextUrl("01012345678", "a b", false)).toBe(
      "https://web.whatsapp.com/send?phone=201012345678&text=a%20b",
    );
    expect(whatsappTextUrl("01012345678", "a", true)).toBe(
      "whatsapp://send?phone=201012345678&text=a",
    );
    expect(whatsappTextUrl("", "a", false)).toBe("https://web.whatsapp.com/send?text=a");
    expect(whatsappTextUrl("https://chat.whatsapp.com/AbCdEfGhIj12", "a", false)).toBe(
      "https://web.whatsapp.com/accept?code=AbCdEfGhIj12",
    );
  });

  it("office title and the saved chat", () => {
    expect(officeTitle("DN/Kafr ElDawar")).toBe("Kafr ElDawar");
    expect(officeTitle("DN")).toBe("DN");
    expect(officeTitle(null)).toBe("All offices");
    expect(normalizeUiPrefs({}).alarms.sendChat).toBe("");
    // hourly image share chats: office names upper-case, bad chats dropped
    expect(
      normalizeUiPrefs({
        hourlyShare: { mode: "office", offices: { " tanta ": "01012345678", X: "nope" } },
      }).hourlyShare,
    ).toEqual({ mode: "office", all: "", offices: { TANTA: "201012345678" } });
    expect(normalizeUiPrefs({ alarms: { sendChat: "010 1234 5678" } }).alarms.sendChat).toBe(
      "201012345678",
    );
  });
});
