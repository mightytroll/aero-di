import * as path from "path";
import * as ts from "typescript";

import {
  ClassData,
  ConstructorData,
  ParameterData,
} from "@app/reflection/dataInterfaces";
import { GenerateReflectionOptions } from "@app/reflection/generateReflection";

const extractParameterNodes = (node: ts.Node, level: number = 0): ts.Node[] => {
  const result: ts.Node[] = [];
  if (ts.isParameter(node)) {
    result.push(node);
  } else if (level < 2) {
    const deeperSearch = node
      .getChildren()
      .map((n) => extractParameterNodes(n, level + 1));
    for (const list of deeperSearch) {
      result.push(...list);
    }
  }
  return result;
};

const extractParameter = (paramNode: ts.Node): ParameterData => {
  const children = paramNode.getChildren();
  // first identifier is name
  // then last node -> identifier is type, can assume text of that node for generics
  const identifiers = children.filter(
    (n) => n.constructor.name === "IdentifierObject"
  );
  const firstIdentifier = identifiers[0];

  const typeReferences = children.filter((n) => ts.isTypeReferenceNode(n));

  let typeTest = "";
  if (typeReferences.length > 0) {
    typeTest = typeReferences[0].getText().trim();
  } else {
    typeTest = children[children.length - 1].getText().trim();
  }

  return {
    name: firstIdentifier.getText(),
    type: typeTest,
  };
};

export const extractConstructor = (
  constructorNode: ts.Node
): ConstructorData => {
  const params = extractParameterNodes(constructorNode);

  let visibility: "public" | "protected" | "private" = "public";
  const maybeVisibilityString = constructorNode.getChildAt(0).getText().trim();
  if (maybeVisibilityString.startsWith("private")) {
    visibility = "private";
  } else if (maybeVisibilityString.startsWith("protected")) {
    visibility = "protected";
  }

  return { visibility, params: params.map((param) => extractParameter(param)) };
};

const isClassAbstract = (classNode: ts.Node): boolean => {
  const chd = classNode.getChildren();
  return chd.length > 0 && chd[0].getText().includes("abstract");
};

export const extractClass = (
  baseDir: string,
  src: ts.SourceFile,
  classNode: ts.Node,
  options: GenerateReflectionOptions
): ClassData => {
  const children = classNode.getChildren();
  const identifiers = children.filter((n) => ts.isIdentifier(n));
  const name = identifiers[0].getText();

  const fqcn = `${path
    .relative(baseDir, src.fileName)
    .replace(/.ts$/, "")
    .replaceAll("\\", "/")}/${name}`;

  const isAbstract = isClassAbstract(classNode);

  const implementsInterfaces: string[] = [];
  let extendsClass: string | null = null;
  const childWithHeritageClauses = children.find((n) =>
    n.getChildren().some((sn) => ts.isHeritageClause(sn))
  );
  if (childWithHeritageClauses) {
    const extendsClause = childWithHeritageClauses
      .getChildren()
      .find((n) => n.getText().startsWith("extends "));

    if (extendsClause) {
      extendsClass = extendsClause
        .getChildAt(extendsClause.getChildCount() - 1)
        .getText();
    }
    const implementsClause = childWithHeritageClauses
      .getChildren()
      .find((n) => n.getText().startsWith("implements "));
    if (implementsClause) {
      const subImplements = implementsClause.getChildAt(
        implementsClause.getChildCount() - 1
      );
      const interfaceTypesNodes = subImplements
        .getChildren()
        .filter((n) => ts.isExpressionWithTypeArguments(n));
      implementsInterfaces.push(
        ...interfaceTypesNodes.map((inter) => inter.getText())
      );
    }
  }
  const subChildren = children.map((c) => c.getChildren()).flat(1);
  const childConstructors = subChildren.filter((n) =>
    ts.isConstructorDeclaration(n)
  );

  // by default is public even if is not specified
  let constructorVisibility: "public" | "protected" | "private" = "public";
  const constructorParameters: ParameterData[] = [];
  if (childConstructors.length > 0) {
    const constructorData = extractConstructor(
      childConstructors[childConstructors.length - 1] // last one is the implementation
    );
    constructorVisibility = constructorData.visibility;
    constructorParameters.push(...constructorData.params);
  }

  if (options.verbose) {
    // eslint-disable-next-line no-console
    console.log(`Found class ${name}`);
  }

  return {
    fqcn,
    name,
    extendsClass,
    implementsInterfaces,
    constructorParameters,
    constructorVisibility,
    ctor: null,
    isAbstract,
  };
};
