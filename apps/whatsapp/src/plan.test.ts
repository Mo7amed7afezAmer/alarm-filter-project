import { describe, expect, it } from "vitest";
import { MAX_IMAGES, chatRef, planSend } from "./plan.js";

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest"),
]).toString("base64");

describe("chatRef", () => {
  it("numbers become a user id, group links keep their invite code", () => {
    expect(chatRef("01012345678")).toEqual({
      kind: "phone",
      phone: "201012345678",
      jid: "201012345678@s.whatsapp.net",
    });
    expect(chatRef("https://chat.whatsapp.com/AbCdEfGhIj12")).toEqual({
      kind: "group",
      code: "AbCdEfGhIj12",
    });
    expect(chatRef("hello")).toBeNull();
  });
});

describe("planSend", () => {
  it("text first, then the images", () => {
    const r = planSend({ chat: "01012345678", text: "hi", images: [{ name: "a.png", data: png }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.messages.map((m) => m.kind)).toEqual(["text", "image"]);
  });

  it("refuses a bad chat, empty sends, non-PNG data and too many images", () => {
    expect(planSend({ chat: "x", text: "hi" })).toEqual({
      ok: false,
      error: "chat must be a WhatsApp number or group link",
    });
    expect(planSend({ chat: "01012345678", text: "  " })).toEqual({
      ok: false,
      error: "nothing to send",
    });
    expect(
      planSend({
        chat: "01012345678",
        images: [{ data: Buffer.from("GIF89a").toString("base64") }],
      }),
    ).toEqual({ ok: false, error: "image 1 is not a PNG" });
    const many = Array.from({ length: MAX_IMAGES + 1 }, () => ({ data: png }));
    expect(planSend({ chat: "01012345678", images: many }).ok).toBe(false);
  });
});
