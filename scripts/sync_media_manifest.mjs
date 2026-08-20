import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(path.join(root, "config/media-manifest.json"), "utf8"));
const templatePath = path.join(root, "ARC_MASTER_TEMPLATE.html");
const template = await readFile(templatePath, "utf8");

if (!Array.isArray(manifest.profiles) || !manifest.profiles.length ||
    manifest.profiles.some(profile => profile.provider !== "local-css" || "photo_ids" in profile || "urls" in profile)) {
  throw new Error("ARC composition manifest must contain local-CSS profiles only");
}

const profiles = manifest.profiles.map(profile => `        {
          key:${JSON.stringify(profile.key)},
          layout:${JSON.stringify(profile.layout)},
          variant:${JSON.stringify(profile.variant)},
          match:new RegExp(${JSON.stringify(profile.match)},"i")
        }`).join(",\n");

const manifestBlock = `/* ARC_COMPOSITION_MANIFEST_START v${manifest.version} */
      const compositionPresets = [
${profiles}
      ];
      /* ARC_COMPOSITION_MANIFEST_END */`;
const manifestPattern = template.includes("/* ARC_COMPOSITION_MANIFEST_START")
  ? /\/\* ARC_COMPOSITION_MANIFEST_START[\s\S]*?\/\* ARC_COMPOSITION_MANIFEST_END \*\//
  : /const unsplash = id =>[\s\S]*?\/\* ARC_MEDIA_MANIFEST_END \*\//;
let next = template.replace(manifestPattern, () => manifestBlock);

const runtime = `      /* ARC_LOCAL_MEDIA_RUNTIME_START */
      const media =
        compositionPresets.find(preset => preset.key === expectedMediaProfile) ||
        compositionPresets.find(preset => preset.key !== "general" && preset.match.test(industryContext)) ||
        compositionPresets[compositionPresets.length - 1];
      document.body.classList.add("arc-layout-"+media.layout);
      document.body.dataset.arcLayout=media.layout;
      document.body.dataset.mediaPreset=media.key;
      document.body.dataset.arcMediaProfile=media.key;
      document.body.dataset.arcMediaVersion=${JSON.stringify(manifest.version)};
      const compositionOrders={
        impact:["top","ticker","services","why","process","gallery","about","proof","faq","contact"],
        trusted:["top","ticker","proof","services","process","about","why","faq","gallery","contact"],
        editorial:["top","ticker","about","gallery","services","why","process","proof","faq","contact"],
        balanced:["top","ticker","services","about","why","process","proof","gallery","faq","contact"]
      };
      const compositionNodes={
        top:$("#top"),ticker:$(".ticker"),services:$("#services"),why:$("#why"),about:$("#about"),
        process:$("#process"),gallery:$("#gallery"),proof:$("#proof"),faq:$("#faq"),contact:$("#contact")
      };
      const contentRoot=$("#content");
      (compositionOrders[media.layout] || compositionOrders.balanced).forEach(key => {
        if(compositionNodes[key])contentRoot?.append(compositionNodes[key]);
      });
      const seedText=[text($(".brand-name")),text($(".brand-location")),primaryIndustry].join("|");
      const mediaSeed=[...seedText].reduce((hash,char) => ((hash * 31) + char.charCodeAt(0)) >>> 0,2166136261);
      const compositionVariant=Number.isInteger(media.variant) ? media.variant : mediaSeed % 3;
      document.body.classList.add("arc-variant-"+compositionVariant);
      document.body.dataset.arcVariant=String(compositionVariant);

      const heroVisual=$(".hero-visual");
      const heroMedia=$(".hero-media");
      const aboutMedia=$(".about-media");
      const galleryGrid=$(".gallery-grid");
      const localShell=node=>{
        if(!node)return;
        node.replaceChildren();
        node.classList.add("visual-direction","arc-local-visual");
        node.dataset.arcMediaProvider="local-css";
        node.setAttribute("aria-hidden","true");
      };
      const galleryShell=()=>{
        const figure=document.createElement("figure");
        localShell(figure);
        return figure;
      };
      const updateMediaState=()=>{
        const heroHasUpload=Boolean(heroMedia?.querySelector("img"));
        const aboutHasUpload=Boolean(aboutMedia?.querySelector("img"));
        const galleryHasUpload=Boolean(galleryGrid?.querySelector("img"));
        heroVisual?.classList.toggle("has-media",heroHasUpload);
        if(heroMedia)heroMedia.hidden=!heroHasUpload;
        if(aboutMedia){
          aboutMedia.classList.toggle("arc-local-visual",!aboutHasUpload);
          aboutMedia.dataset.arcMediaProvider=aboutHasUpload?"customer-upload":"local-css";
        }
        if(galleryGrid)galleryGrid.dataset.arcMediaProvider=galleryHasUpload?"customer-upload":"local-css";
        document.body.dataset.arcMediaProvider=document.querySelector("img")?"customer-upload":"local-css";
      };
      const failUpload=node=>{
        const grid=node.closest(".gallery-grid");
        const galleryItem=grid?[...grid.children].find(child=>child===node||child.contains(node)):null;
        const picture=node.closest("picture");
        const failedNode=picture||node;
        if(grid&&galleryItem===failedNode)grid.replaceChild(galleryShell(),galleryItem);
        else{
          failedNode.remove();
          if(galleryItem&&!galleryItem.querySelector("img"))localShell(galleryItem);
        }
        updateMediaState();
      };
      const prepareUpload=node=>{
        if(node.dataset.arcMediaFallbackReady==="true")return;
        node.dataset.arcMediaFallbackReady="true";
        node.dataset.arcMediaProfile=media.key;
        node.dataset.arcMediaProvider="customer-upload";
        node.dataset.arcMediaVersion=${JSON.stringify(manifest.version)};
        node.addEventListener("error",()=>failUpload(node),{once:true});
        if(node.complete&&node.naturalWidth===0)failUpload(node);
      };
      $$("img").forEach(prepareUpload);
      const uploadObserver=new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(added=>{
        if(added.nodeType!==Node.ELEMENT_NODE)return;
        if(added.matches?.("img"))prepareUpload(added);
        added.querySelectorAll?.("img").forEach(prepareUpload);
      })));
      uploadObserver.observe(document.documentElement,{childList:true,subtree:true});
      if(galleryGrid&&!galleryGrid.querySelector("img")){
        galleryGrid.replaceChildren(galleryShell(),galleryShell(),galleryShell());
      }else if(galleryGrid){
        [...galleryGrid.children].filter(node=>!node.querySelector("img")).forEach(localShell);
      }
      [
        ["#why",".why-grid"],
        ["#proof",".proof-grid"],
        ["#faq",".faq-list"]
      ].forEach(([section,content]) => {
        if(contentIsFake($(content)))$(section)?.setAttribute("hidden","");
      });
      updateMediaState();
      /* ARC_LOCAL_MEDIA_RUNTIME_END */`;
const runtimePattern = next.includes("/* ARC_LOCAL_MEDIA_RUNTIME_START */")
  ? /      \/\* ARC_LOCAL_MEDIA_RUNTIME_START \*\/[\s\S]*?      \/\* ARC_LOCAL_MEDIA_RUNTIME_END \*\//
  : /      const media =\n[\s\S]*?(?=\n\n      \$\$\('a\[href)/;
next = next.replace(runtimePattern, () => runtime);

if (next === template) {
  console.log(`ARC local composition manifest already synced (v${manifest.version}).`);
  process.exit(0);
}
if (!next.includes(`/* ARC_COMPOSITION_MANIFEST_START v${manifest.version} */`) ||
    next.includes("ARC_MEDIA_MANIFEST_START") || next.includes("mediaPresets") ||
    /images\.(?:unsplash|pexels)\.com|arcsites\.netlify\.app\/assets\/showcases/i.test(next)) {
  throw new Error("ARC local composition sync did not remove remote media catalogs");
}
await writeFile(templatePath, next);
console.log(`Synced ${manifest.profiles.length} local-CSS ARC composition profiles (v${manifest.version}).`);
