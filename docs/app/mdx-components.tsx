import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";

export const getMDXComponents = (components?: MDXComponents) =>
  ({
    ...defaultMdxComponents,
    ...components,
  }) satisfies MDXComponents;

export const useMDXComponents = getMDXComponents;
