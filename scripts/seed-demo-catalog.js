/**
 * Creates the case study's 10 fictional demo products on a Shopify
 * development store, from scripts/demo-catalog.json.
 *
 * Usage:
 *   shopify store auth --store <store>.myshopify.com --scopes write_products,read_publications,write_publications
 *   node scripts/seed-demo-catalog.js --store <store>.myshopify.com         # dry run, changes nothing
 *   node scripts/seed-demo-catalog.js --store <store>.myshopify.com --yes   # create the products
 *
 * What it does: creates the custom.verified_facts metafield definition if it
 * is missing, creates each product that doesn't exist yet (by handle) and
 * publishes it to the Online Store. It never edits or deletes anything, and it
 * refuses to run on a store that isn't a development store, or whose
 * custom.verified_facts definition has a different type.
 *
 * Talks to Shopify through the Shopify CLI (`shopify store execute`), using
 * your own CLI login. This is reviewer tooling, not part of the app.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEMO_TAG,
  FACTS_DEFINITION,
  checkDefinition,
  checkStore,
  planSeed,
  toProductSetInput,
} from "./demo-catalog-lib.js";

const args = process.argv.slice(2);
const store = args[args.indexOf("--store") + 1];
const apply = args.includes("--yes");

if (!args.includes("--store") || !store?.endsWith(".myshopify.com")) {
  console.error("Usage: node scripts/seed-demo-catalog.js --store <store>.myshopify.com [--yes]");
  process.exit(1);
}

const catalog = JSON.parse(readFileSync(new URL("./demo-catalog.json", import.meta.url), "utf8"));
const workDir = mkdtempSync(join(tmpdir(), "seed-demo-catalog-"));

// Runs one GraphQL operation with `shopify store execute` and returns `data`.
function execute(query, variables = {}, { mutation = false } = {}) {
  const queryFile = join(workDir, "query.graphql");
  const variablesFile = join(workDir, "variables.json");
  const outputFile = join(workDir, "output.json");
  writeFileSync(queryFile, query);
  writeFileSync(variablesFile, JSON.stringify(variables));

  const cliArgs = [
    "store", "execute",
    "--store", store,
    "--query-file", queryFile,
    "--variable-file", variablesFile,
    "--output-file", outputFile,
    "--no-color",
  ];
  if (mutation) cliArgs.push("--allow-mutations");

  try {
    execFileSync("shopify", cliArgs, { stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new Error(`shopify store execute failed:\n${output || error.message}`);
  }

  const result = JSON.parse(readFileSync(outputFile, "utf8"));
  return result.data ?? result;
}

// The product ID plus its first variant, for the test cart paths printed at the end.
const PRODUCT_IDS = "id variants(first: 1) { nodes { id } }";

// Shop, facts definition, Online Store publication and existing handles in one query.
function readStore() {
  const handleLookups = catalog.products
    .map(
      (product, index) =>
        `p${index}: productByIdentifier(identifier: { handle: ${JSON.stringify(product.handle)} }) { ${PRODUCT_IDS} }`,
    )
    .join("\n    ");

  const data = execute(`query SeedDemoCatalogState {
    shop { name myshopifyDomain plan { partnerDevelopment } }
    definitions: metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: "custom", key: "verified_facts") {
      nodes { id type { name } }
    }
    publications(first: 20) { nodes { id name } }
    ${handleLookups}
  }`);

  return {
    shop: data.shop,
    definition: data.definitions.nodes[0] ?? null,
    onlineStore: data.publications.nodes.find((publication) => publication.name === "Online Store") ?? null,
    existingHandles: catalog.products.filter((_, index) => data[`p${index}`]).map((product) => product.handle),
    existingProducts: catalog.products
      .map((product, index) => ({ title: product.title, ids: data[`p${index}`] }))
      .filter((product) => product.ids),
  };
}

function createDefinition() {
  const data = execute(
    `mutation CreateFactsDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id }
        userErrors { field message }
      }
    }`,
    { definition: FACTS_DEFINITION },
    { mutation: true },
  );
  return data.metafieldDefinitionCreate.userErrors;
}

function createProduct(product) {
  const data = execute(
    `mutation SeedProduct($input: ProductSetInput!) {
      productSet(input: $input, synchronous: true) {
        product { ${PRODUCT_IDS} }
        userErrors { field message }
      }
    }`,
    { input: toProductSetInput(product) },
    { mutation: true },
  );
  return data.productSet;
}

function publish(productId, publicationId) {
  const data = execute(
    `mutation PublishProduct($id: ID!, $publicationId: ID!) {
      publishablePublish(id: $id, input: [{ publicationId: $publicationId }]) {
        userErrors { field message }
      }
    }`,
    { id: productId, publicationId },
    { mutation: true },
  );
  return data.publishablePublish.userErrors;
}

function main() {
  const state = readStore();

  const refusal = checkStore(state.shop) ?? checkDefinition(state.definition);
  if (refusal) {
    console.error(refusal);
    process.exitCode = 1;
    return;
  }

  const plan = planSeed({
    catalog,
    existingHandles: state.existingHandles,
    hasDefinition: state.definition !== null,
  });

  console.log(`Store: ${state.shop.name} (${state.shop.myshopifyDomain}), development store`);
  console.log(`Metafield definition custom.verified_facts: ${plan.createDefinition ? "create" : "exists"}`);
  for (const product of plan.create) console.log(`  create  ${product.title}`);
  for (const product of plan.skip) console.log(`  skip    ${product.title} (handle ${product.handle} exists)`);
  if (plan.create.length > 0 && !state.onlineStore) {
    console.log("  note    no Online Store publication found; products won't be published");
  }

  if (!plan.createDefinition && plan.create.length === 0) {
    console.log("Nothing to do.");
    printCartPaths(state.existingProducts);
    return;
  }
  if (!apply) {
    console.log("Dry run: nothing changed. Run again with --yes to apply.");
    return;
  }

  let failures = 0;
  const created = [];
  const report = (label, errors) => {
    if (errors.length === 0) return console.log(`  done    ${label}`);
    failures += 1;
    console.error(`  failed  ${label}: ${errors.map((error) => error.message).join("; ")}`);
  };

  if (plan.createDefinition) report("metafield definition", createDefinition());

  for (const product of plan.create) {
    const result = createProduct(product);
    report(product.title, result.userErrors);
    if (result.product) created.push({ title: product.title, ids: result.product });
    if (result.product && state.onlineStore) {
      report(`publish ${product.title}`, publish(result.product.id, state.onlineStore.id));
    }
  }

  console.log(
    failures
      ? `Finished with ${failures} error(s).`
      : `Created ${plan.create.length} products tagged "${DEMO_TAG}".`,
  );
  printCartPaths([...state.existingProducts, ...created]);
  process.exitCode = failures ? 1 : 0;
}

// Cart paths for test checkouts: put one after the store domain, or swap it
// into the cart part of the post-purchase dev link.
function printCartPaths(products) {
  if (products.length === 0) return;
  console.log("\nTest cart paths (first variant of each product):");
  for (const { title, ids } of products) {
    const variantId = ids.variants.nodes[0]?.id.split("/").pop();
    if (variantId) console.log(`  /cart/${variantId}:1   ${title}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
