import rehypeExternalLinks from "rehype-external-links";
import rehypeKatex from "rehype-katex";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkGithub, { defaultBuildUrl } from "remark-github";
import { remarkAlert } from "remark-github-blockquote-alert";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { type Processor, unified } from "unified";
import { visit } from "unist-util-visit";

export interface MarkdownOptions {
  sanitize?: boolean;
  gfm?: boolean;
  math?: boolean;
  breaks?: boolean;
  github?: string;
  prettyCode: boolean;
  externalLinks: boolean;
}

const defaultOptions: MarkdownOptions = {
  sanitize: true,
  gfm: true,
  math: true,
  breaks: false,
  github: undefined,
  prettyCode: true,
  externalLinks: true,
};

export class Markdown {
  private processor: Processor;
  constructor(options: Partial<MarkdownOptions> = {}) {
    this.processor = unified();
    this.processor.use(remarkParse);
    const opts: MarkdownOptions = { ...defaultOptions, ...options };
    this.initPlugins(opts);
  }

  private initPlugins(options?: Partial<MarkdownOptions>) {
    if (options?.gfm) {
      this.processor.use(remarkGfm);
    }
    if (options?.breaks) {
      this.processor.use(remarkBreaks);
    }
    if (options?.github) {
      this.processor.use(remarkGithub, {
        repository: options.github,
        buildUrl(values) {
          return defaultBuildUrl(values);
        },
      });
      this.processor.use(remarkAlert);
      // make blockquote alert title capitalized
      this.processor.use(() => (tree) => {
        // biome-ignore lint/suspicious/noExplicitAny: this should be Node
        visit(tree, "blockquote", (node: any) => {
          if (node.children && node.children.length > 0 && node.children[0].type === "paragraph") {
            const firstParagrash = node.children[0];
            if (firstParagrash.children && firstParagrash.children.length > 1) {
              const first = firstParagrash.children[0];
              const isFirstSvg = first.type === "emphasis" && first.data && first.data.hName === "svg";
              const second = firstParagrash.children[1];
              const isSecondText = second.type === "text";
              if (isFirstSvg && isSecondText) {
                second.value = second.value.charAt(0).toUpperCase() + second.value.toLowerCase().slice(1);
              }
            }
          }
        });
      });
    }
    if (options?.math) {
      this.processor?.use(remarkMath);
    }
    // rehype
    this.processor.use(remarkRehype);
    if (options?.sanitize && !options.github) {
      const schema = Object.assign({}, defaultSchema);
      schema.attributes = Object.assign({}, schema.attributes, {
        div: [["className", /^markdown-alert(-.+)?$/]],
        p: [["className", /^markdown-alert(-.+)?$/]],
        svg: [["className", /^octicon$/], ["viewBox"], ["aria-hidden"], ["height"], ["width"], ["fill"]],
        path: [["d"], ["fill-rule"]],
      });
      schema.tagNames!.push("svg", "path");
      this.processor?.use(rehypeSanitize, schema);
    }
    if (options?.externalLinks) {
      this.processor?.use(rehypeExternalLinks, {
        target: "_blank",
        rel: ["noopener", "noreferrer"],
      });
    }

    if (options?.math) {
      this.processor?.use(rehypeKatex);
      import("katex/dist/katex.css");
      import("@/styles/katex.css");
    }
    if (options?.prettyCode) {
      this.processor?.use(rehypePrettyCode, {
        grid: true,
        theme: {
          dark: "github-dark",
          light: "github-light",
        },
        keepBackground: false,
        bypassInlineCode: false,
      });
    }
    this.processor.use(rehypeStringify);
    return this;
  }

  async render(markdown: string) {
    const vfile = await this.processor.process(markdown);
    return vfile.toString();
  }
}
