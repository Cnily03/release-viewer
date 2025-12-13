import rehypeExternalLinks from "rehype-external-links";
import rehypeGithubAlert from "rehype-github-alert";
import rehypeGithubColor from "rehype-github-color";
import rehypeGithubDir from "rehype-github-dir";
import rehypeGithubEmoji from "rehype-github-emoji";
import rehypeGithubImage from "rehype-github-image";
import rehypeGithubNoTranslate from "rehype-github-notranslate";
import rehypeKatex from "rehype-katex";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkGithub, { defaultBuildUrl } from "remark-github";
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
        mentionStrong: false,
        buildUrl(values) {
          return defaultBuildUrl(values);
        },
      });
      this.processor.use(() => (tree) => {
        // biome-ignore lint/suspicious/noExplicitAny: this should be Node
        visit(tree, "link", (node: any) => {
          if (node.children && node.children.length === 1) {
            const child = node.children[0];
            if (child.type !== "text") return;
            const value = child.value;
            const url = node.url.replace(/^http:\/\//, "https://");
            const base = "https://github.com";
            if (value.length > 0 && value[0] === "@") {
              const user = value.slice(1);
              if (url === `${base}/${user}`) {
                // add class
                node.data = {
                  hProperties: {
                    className: "user-mention",
                  },
                };
              }
            }
          }
        });
      });
    }
    if (options?.math) {
      this.processor.use(remarkMath);
    }
    // rehype
    this.processor.use(remarkRehype);
    if (options?.github) {
      this.processor
        ?.use(rehypeGithubAlert)
        .use(rehypeGithubColor)
        .use(rehypeGithubDir)
        .use(rehypeGithubEmoji)
        .use(rehypeGithubImage)
        .use(rehypeGithubNoTranslate);
    }
    if (options?.sanitize && !options.github) {
      const schema = Object.assign({}, defaultSchema);
      schema.attributes = Object.assign({}, schema.attributes, {
        div: [["className", /^markdown-alert(-.+)?$/]],
        p: [["className", /^markdown-alert(-.+)?$/]],
        svg: [["className", /^octicon$/], ["viewBox"], ["aria-hidden"], ["height"], ["width"], ["fill"]],
        path: [["d"], ["fill-rule"]],
      });
      schema.tagNames!.push("svg", "path");
      this.processor.use(rehypeSanitize, schema);
    }
    if (options?.externalLinks) {
      this.processor.use(rehypeExternalLinks, {
        target: "_blank",
        rel: ["noopener", "noreferrer"],
      });
    }

    if (options?.math) {
      this.processor.use(rehypeKatex);
      import("katex/dist/katex.css");
      import("@/styles/katex.css");
    }
    if (options?.prettyCode) {
      this.processor.use(rehypePrettyCode, {
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
    return String(vfile);
  }
}
