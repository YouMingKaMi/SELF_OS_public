import ts from "typescript";

const methods = new Set(["get", "post", "put", "delete", "patch"]);

export function runtimeRoutes(source: string) {
  const file = ts.createSourceFile("app.ts", source, ts.ScriptTarget.Latest, true);
  const routes = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const { expression: receiver, name } = node.expression;
      const [route] = node.arguments;
      if (ts.isIdentifier(receiver) && receiver.text === "app" && methods.has(name.text) &&
        route && ts.isStringLiteralLike(route) && route.text.startsWith("/v1/")) {
        const path = route.text.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, "{$1}");
        routes.add(`${name.text} ${path}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return routes;
}
