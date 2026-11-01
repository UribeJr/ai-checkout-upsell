import { catalogSearchQuery } from "./catalog-scope";

/**
 * Admin GraphQL reads of the product catalog. Shopify is the source of truth;
 * the app only needs `read_products` for these queries.
 */

const PRODUCT_FIELDS = `#graphql
  fragment CatalogProduct on Product {
    id
    handle
    title
    status
    description
    productType
    tags
    options {
      name
      values
    }
    variants(first: 50) {
      nodes {
        id
        title
      }
    }
    verifiedFacts: metafield(namespace: "custom", key: "verified_facts") {
      value
    }
  }`;

const ACTIVE_PRODUCTS_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query CatalogProducts($after: String, $query: String!) {
    products(first: 50, after: $after, query: $query) {
      nodes {
        ...CatalogProduct
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }`;

const PRODUCT_QUERY = `#graphql
  ${PRODUCT_FIELDS}
  query CatalogProduct($id: ID!) {
    product(id: $id) {
      ...CatalogProduct
    }
  }`;

// Returns one product (any status), or null if it no longer exists.
export async function fetchProduct(admin, productId) {
  const response = await admin.graphql(PRODUCT_QUERY, { variables: { id: productId } });
  const { data } = await response.json();
  return data.product;
}

// Returns every ACTIVE product (with the upsell tag, when one is set),
// following pagination.
export async function fetchActiveProducts(admin, { tag = null } = {}) {
  const products = [];
  let after = null;

  do {
    const response = await admin.graphql(ACTIVE_PRODUCTS_QUERY, {
      variables: { after, query: catalogSearchQuery(tag) },
    });
    const { data } = await response.json();

    products.push(...data.products.nodes);
    after = data.products.pageInfo.hasNextPage
      ? data.products.pageInfo.endCursor
      : null;
  } while (after);

  return products;
}
