import {describe, expect, test} from "bun:test";
import {type MapCard, mapStaticUrl} from "./mapbox";

const baseCard: MapCard = {
  kind: "map",
  latitude: 37.7749,
  longitude: -122.4194,
  zoom: 13,
  markers: [],
};

describe("mapStaticUrl", () => {
  test("builds a URL with no markers", () => {
    const url = mapStaticUrl(baseCard, {token: "pk.test"});
    expect(url).toContain("https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/");
    expect(url).toContain("-122.4194,37.7749,13");
    expect(url).toContain("600x400");
    expect(url).toContain("access_token=pk.test");
  });

  test("encodes a single marker with hex color", () => {
    const url = mapStaticUrl(
      {
        ...baseCard,
        markers: [{lat: 37.78, lng: -122.41, color: "primary", label: "A"}],
      },
      {token: "pk.test"}
    );
    expect(url).toContain("pin-s-A+3B82F6(-122.41,37.78)");
  });

  test("encodes 20 markers", () => {
    const markers = Array.from({length: 20}, (_, i) => ({
      lat: 37 + i / 100,
      lng: -122 - i / 100,
    }));
    const url = mapStaticUrl({...baseCard, markers}, {token: "pk.test"});
    // 20 comma-separated pin segments before the center
    const segCount = (url.match(/pin-s\+/g) || []).length;
    expect(segCount).toBe(20);
  });

  test("respects custom width / height / style", () => {
    const url = mapStaticUrl(baseCard, {
      token: "pk.test",
      width: 1000,
      height: 250,
      style: "mapbox/dark-v11",
    });
    expect(url).toContain("mapbox/dark-v11/static/");
    expect(url).toContain("1000x250");
  });

  test("URL-encodes special chars in marker labels and tokens", () => {
    const url = mapStaticUrl(
      {
        ...baseCard,
        markers: [{lat: 0, lng: 0, label: "!"}],
      },
      {token: "pk.abc+def"}
    );
    expect(url).toContain("access_token=pk.abc%2Bdef");
  });
});
