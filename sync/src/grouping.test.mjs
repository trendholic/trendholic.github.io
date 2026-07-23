// Automated tests for physical-product grouping (Task 4).
// Fixtures are the REAL image filenames observed live on 2026-07-23.
// Run: node --test src/grouping.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { imageInfo, groupProductPages, deriveProductName, stripIndexToken } from "./grouping.js";

const DIR = "https://tangma2088.com/upfile/product/202607/";
const img = (file) => ({ source_url: DIR + encodeURI(file) });

test("imageInfo parses base name, index, and image id", () => {
  const i = imageInfo(DIR + encodeURI("Balenciaga XS-L 20tr150 (1)_5715909.jpg"));
  assert.equal(i.baseName, "Balenciaga XS-L 20tr150");
  assert.equal(i.index, 1);
  assert.equal(i.imageId, "5715909");
  assert.equal(i.baseKey, "upfile/product/202607/balenciaga xs-l 20tr150");
});

test("all image-level pages of one product collapse into ONE physical product", () => {
  // 4 real productinfoen pages, each showing a sliding window of the SAME product
  const pages = [
    { sourceProductId: "5715909", sourceUrl: "u/5715909", images:
      ["(1)_5715909","(2)_5715908","(3)_5715907","(4)_5715906","(5)_5715905"].map((s) => img(`Balenciaga XS-L 20tr150 ${s}.jpg`)) },
    { sourceProductId: "5715908", sourceUrl: "u/5715908", images:
      ["(2)_5715908","(1)_5715909","(3)_5715907","(4)_5715906","(5)_5715905"].map((s) => img(`Balenciaga XS-L 20tr150 ${s}.jpg`)) },
    { sourceProductId: "5715905", sourceUrl: "u/5715905", images:
      ["(5)_5715905","(3)_5715907","(4)_5715906","(6)_5715904","(7)_5715903"].map((s) => img(`Balenciaga XS-L 20tr150 ${s}.jpg`)) },
    { sourceProductId: "5715904", sourceUrl: "u/5715904", images:
      ["(6)_5715904","(4)_5715906","(5)_5715905","(7)_5715903","(8)_5715902"].map((s) => img(`Balenciaga XS-L 20tr150 ${s}.jpg`)) },
  ];
  const groups = groupProductPages(pages);
  assert.equal(groups.length, 1, "must be ONE physical product, not four");
  const g = groups[0];
  assert.equal(g.name, "Balenciaga XS-L 20tr150", "clean name, no (n) index, no album suffix");
  assert.equal(g.images.length, 8, "union of all images across pages = (1)..(8)");
  assert.equal(g.parent_product_id, "5715902", "smallest image id is the stable parent id");
  assert.deepEqual(g.page_ids.sort(), ["5715904","5715905","5715908","5715909"]);
  // images are ordered by their (n) index
  assert.equal(imageInfo(g.images[0].source_url).index, 1);
  assert.equal(imageInfo(g.images[7].source_url).index, 8);
});

test("genuinely different products are NOT merged", () => {
  const pages = [
    { sourceProductId: "5715909", sourceUrl: "u/a", images: [img("Balenciaga XS-L 20tr150 (1)_5715909.jpg")] },
    { sourceProductId: "2020015", sourceUrl: "u/b", images: [img("Prada 1BE106 23x24 5x15cm AP (1)_2020015.jpg")] },
  ];
  const groups = groupProductPages(pages);
  assert.equal(groups.length, 2, "different image bases stay separate");
  const names = groups.map((g) => g.name).sort();
  assert.deepEqual(names, ["Balenciaga XS-L 20tr150", "Prada 1BE106 23x24 5x15cm AP"]);
});

test("similar-looking but distinct products stay distinct", () => {
  const pages = [
    { sourceProductId: "1", sourceUrl: "u/1", images: [img("Nike Air 100 (1)_11.jpg")] },
    { sourceProductId: "2", sourceUrl: "u/2", images: [img("Nike Air 200 (1)_22.jpg")] }, // different model number
  ];
  assert.equal(groupProductPages(pages).length, 2);
});

test("stripIndexToken handles all three real source formats", () => {
  assert.equal(stripIndexToken("Balenciaga XS-L 20tr150 (1)"), "Balenciaga XS-L 20tr150"); // apparel/acc
  assert.equal(stripIndexToken("Victorias secret boxer M-XL 32 (6)"), "Victorias secret boxer M-XL 32");
  assert.equal(stripIndexToken("Valentino sz38-45 WM0702 02"), "Valentino sz38-45 WM0702");  // shoes
  assert.equal(stripIndexToken("Prada 1BE106 23x24 5x15cm AP2"), "Prada 1BE106 23x24 5x15cm AP"); // bags
});

test("BAGS format (APn, no parens) groups correctly", () => {
  const D = "https://bags.tangma2088.com/upfile/product/202607/";
  const bimg = (f) => ({ source_url: D + encodeURI(f) });
  const pages = [
    { sourceProductId: "2020015", sourceUrl: "b/1", images: ["Prada 1BE106 23x24 5x15cm AP1_2020015.jpg","Prada 1BE106 23x24 5x15cm AP2_2020014.jpg"].map(bimg) },
    { sourceProductId: "2020014", sourceUrl: "b/2", images: ["Prada 1BE106 23x24 5x15cm AP2_2020014.jpg","Prada 1BE106 23x24 5x15cm AP1_2020015.jpg"].map(bimg) },
  ];
  const g = groupProductPages(pages);
  assert.equal(g.length, 1);
  assert.equal(g[0].name, "Prada 1BE106 23x24 5x15cm AP");
  assert.equal(g[0].images.length, 2);
  assert.equal(g[0].parent_product_id, "2020014");
});

test("SHOES format (0n, space, zero-padded) groups correctly", () => {
  const D = "https://shoes.tangma2088.com/upfile/product/202607/";
  const simg = (f) => ({ source_url: D + encodeURI(f) });
  const pages = [
    { sourceProductId: "2988674", sourceUrl: "s/1", images: ["Valentino sz38-45 WM0702 01_2988674.jpg","Valentino sz38-45 WM0702 02_2988673.jpg"].map(simg) },
    { sourceProductId: "2988673", sourceUrl: "s/2", images: ["Valentino sz38-45 WM0702 02_2988673.jpg","Valentino sz38-45 WM0702 01_2988674.jpg"].map(simg) },
  ];
  const g = groupProductPages(pages);
  assert.equal(g.length, 1);
  assert.equal(g[0].name, "Valentino sz38-45 WM0702");
  assert.equal(g[0].images.length, 2);
  assert.equal(g[0].parent_product_id, "2988673");
});

test("deriveProductName trims", () => {
  assert.equal(deriveProductName("  Valentino sz38-45 WM0702  "), "Valentino sz38-45 WM0702");
});
