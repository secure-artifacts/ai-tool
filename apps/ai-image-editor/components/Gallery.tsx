import React, { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { AppContext } from '../AppContext';
import { MagicGroup, MagicPrompt } from '../types';
import ConfirmDialog from '@/components/ConfirmDialog';
import { fetchUserPresetsFromSheet, savePresetRowsToSheet, DEFAULT_PRESET_SUBMIT_URL } from '@/services/presetSheetService';
import {
    SHARED_PRESET_SHEET_CONFIG,
    PRESET_SCOPE_MAGIC,
    encodeScopedCategory,
    extractScopedRows
} from '@/services/presetSheetConfig';
import { getShouldSkipPresetSaveConfirm, setShouldSkipPresetSaveConfirm } from '@/services/presetPreferences';

const DEFAULT_PRESET_GROUPS: MagicGroup[] = [
    {
        id: 'refine', nameKey: 'magic_panel.group.refine', prompts: [
            { id: 'hd', nameKey: 'magic_panel.prompt.hd', prompt: '将图像提升至高清画质。增强细节、锐度和清晰度，使其看起来专业且富有照片真实感。' },
            { id: 'cinematic', nameKey: 'magic_panel.prompt.cinematic', prompt: '为图像应用电影感光效。添加戏剧性的阴影和高光，营造出富有情感和故事性的氛围。' },
            { id: 'fix_lighting', nameKey: 'magic_panel.prompt.fix_lighting', prompt: '修正图像中的光照。平衡曝光，减少刺眼的阴影，确保主体光照良好且自然。' },
            { id: 'enhance_texture', nameKey: 'magic_panel.prompt.enhance_texture', prompt: '增强画面主体的材质质感。突出纹理细节，例如布料的纹理、金属的光泽或皮肤的质感，使其更加逼真。' },
            { id: 'improve_atmosphere', nameKey: 'magic_panel.prompt.improve_atmosphere', prompt: '提升画面整体氛围。调整色彩和光影，使画面更明亮、温暖或具有某种特定情感（如宁静、神秘），让画面更具吸引力。' },
            { id: 'color_boost', nameKey: 'magic_panel.prompt.color_boost', prompt: '增强色彩饱和度与活力。让画面色彩更加鲜艳生动，但保持自然和谐，不会过饱和。' },
        ]
    },
    {
        id: 'remove', nameKey: 'magic_panel.group.remove', prompts: [
            { id: 'remove_text', nameKey: 'magic_panel.prompt.remove_text', prompt: '移除蒙版区域内的所有文字，并用周围的背景无缝填充。' },
            { id: 'remove_watermark', nameKey: 'magic_panel.prompt.remove_watermark', prompt: '移除蒙版区域内的水印，并用周围的背景无缝填充。' },
            { id: 'remove_logo', nameKey: 'magic_panel.prompt.remove_logo', prompt: '移除蒙版区域内的标志，并用周围的背景无缝填充。' },
            { id: 'remove_bubble', nameKey: 'magic_panel.prompt.remove_bubble', prompt: '移除蒙版区域内的对话气泡，并用周围的背景无缝填充。' },
            { id: 'remove_foreground', nameKey: 'magic_panel.prompt.remove_foreground', prompt: '移除蒙版区域内的前景物体，并智能地填充其后的背景。' },
            { id: 'remove_background', nameKey: 'magic_panel.prompt.remove_background', prompt: '移除背景，只保留蒙版区域内的主体。' },
            { id: 'remove_person', nameKey: 'magic_panel.prompt.remove_person', prompt: '移除蒙版区域内的人物，并智能地填充其后的背景。' },
            { id: 'remove_masked_area', nameKey: 'magic_panel.prompt.remove_masked_area', prompt: '完全移除蒙版区域的内容，并根据周围图像内容进行无缝且真实的填充。' },
        ]
    },
     {
        id: 'portrait', nameKey: 'magic_panel.group.portrait', prompts: [
            { id: 'portrait_remove_highlight', nameKey: 'magic_panel.prompt.portrait_remove_highlight', prompt: '删除人物面部高光，使得光线柔和自然。' },
            { id: 'portrait_remove_shadow', nameKey: 'magic_panel.prompt.portrait_remove_shadow', prompt: '去除人物面部的强烈阴影，让光线对比更柔和自然。' },
            { id: 'portrait_fair_skin', nameKey: 'magic_panel.prompt.portrait_fair_skin', prompt: '修复肌肤，使其白皙细腻、红润有光泽。' },
            { id: 'portrait_brown_hair', nameKey: 'magic_panel.prompt.portrait_brown_hair', prompt: '将人物头发颜色改为棕色。' },
            { id: 'portrait_add_sacred_heart', nameKey: 'magic_panel.prompt.portrait_add_sacred_heart', prompt: '为人物胸前添加红色圣心。' },
            { id: 'portrait_add_sacred_heart_7', nameKey: 'magic_panel.prompt.portrait_add_sacred_heart_7', prompt: '为人物胸前添加插着七把匕首的圣心。' },
            { id: 'portrait_fix_makeup', nameKey: 'magic_panel.prompt.portrait_fix_makeup', prompt: '修复人物面部，使其拥有玛丽亚般美丽成熟的妆容。' },
            { id: 'portrait_hands_prayer', nameKey: 'magic_panel.prompt.portrait_hands_prayer', prompt: '人物动作改为双手合十祈祷状。' },
            { id: 'portrait_fingers_crossed', nameKey: 'magic_panel.prompt.portrait_fingers_crossed', prompt: '人物动作改为双手握紧，十指交叉相扣的祈祷。' },
            { id: 'portrait_fix_face', nameKey: 'magic_panel.prompt.portrait_fix_face', prompt: '修饰蒙版区域内的人脸。去除瑕疵，平滑肌肤，使其看起来自然。' },
            { id: 'portrait_smile', nameKey: 'magic_panel.prompt.portrait_smile', prompt: '让蒙版区域内的人像露出一个温和、自然的微笑。' },
            { id: 'portrait_fix_hands', nameKey: 'magic_panel.prompt.portrait_fix_hands', prompt: '修正并修复蒙版区域内人像的手部，使其符合解剖学且看起来自然。' },
        ]
    },
    {
        id: 'clothing', nameKey: 'magic_panel.group.clothing', prompts: [
            { id: 'tidy_outfit', nameKey: 'magic_panel.prompt.tidy_outfit', prompt: '整理选中区域人物的服装。修正衣物不合理的褶皱、穿插或松垮部分，使其穿着得体、整洁、有气质。' },
            { id: 'change_color', nameKey: 'magic_panel.prompt.change_color', prompt: '将选中区域服装的颜色变为鲜艳的红色。' },
            { id: 'add_pattern', nameKey: 'magic_panel.prompt.add_pattern', prompt: '为选中区域的服装面料添加精致的碎花图案。' },
            { id: 'modern_suit', nameKey: 'magic_panel.prompt.modern_suit', prompt: '将选中区域人物的服装更换为一套时尚、合身的现代商务西装。' },
            { id: 'light_blue_robe', nameKey: 'magic_panel.prompt.light_blue_robe', prompt: '将选中区域的服装更换为一件飘逸的浅蓝色外袍。' },
            { id: 'blue_robe', nameKey: 'magic_panel.prompt.blue_robe', prompt: '将选中区域的服装更换为一件深邃的蓝色外袍。' },
            { id: 'green_robe', nameKey: 'magic_panel.prompt.green_robe', prompt: '将选中区域的服装更换为一件优雅的绿色外袍。' },
            { id: 'light_green_robe', nameKey: 'magic_panel.prompt.light_green_robe', prompt: '将选中区域的服装更换为一件清新的浅绿色外袍。' },
            { id: 'white_robe', nameKey: 'magic_panel.prompt.white_robe', prompt: '将选中区域的服装更换为一件圣洁的白色外袍。' },
            { id: 'silk_texture', nameKey: 'magic_panel.prompt.silk_texture', prompt: '将选中区域的服装材质变为带有光泽感的丝绸质感。' },
        ]
    },
    {
        id: 'background', nameKey: 'magic_panel.group.background', prompts: [
            { id: 'bg_remove', nameKey: 'magic_panel.prompt.remove_bg', prompt: '完全移除背景，只保留主体。输出应为透明背景。' },
            { id: 'bg_spring_cherry', nameKey: 'magic_panel.prompt.bg_spring_cherry', prompt: '修改背景为春日樱花场景，画面通透明亮。' },
            { id: 'bg_summer_countryside', nameKey: 'magic_panel.prompt.bg_summer_countryside', prompt: '背景修改为温馨明媚的夏日田园，绿意盎然，十分惬意。' },
            { id: 'bg_autumn_maple', nameKey: 'magic_panel.prompt.bg_autumn_maple', prompt: '背景修改为色彩浓郁的秋叶景象，红色、黄色、橙色的树叶构成一幅美丽的画卷，色彩通透明亮。' },
            { id: 'bg_winter_snow', nameKey: 'magic_panel.prompt.bg_winter_snow', prompt: '背景修改为冬日白雪皑皑的场景，雪地在阳光的照射下画面温柔唯美。' },
            { id: 'bg_beautiful_garden', nameKey: 'magic_panel.prompt.bg_beautiful_garden', prompt: '背景修改为阳光明媚的花园，繁花盛开、鸟语轻鸣、微风拂动，绿叶斑驳、空气通透，氛围宁静而生机盎然。' },
            { id: 'bg_village', nameKey: 'magic_panel.prompt.bg_village', prompt: '背景修改为乡村场景，生动、美丽，充满光明的，有生机的。' },
            { id: 'bg_church', nameKey: 'magic_panel.prompt.bg_church', prompt: '背景修改为浅色的基督教教堂门前，阳光明媚，蓝天白云。' },
            { id: 'bg_park', nameKey: 'magic_panel.prompt.bg_park', prompt: '背景修改为绿意安然的公园场景,光线通透明亮，氛围温柔浪漫。' },
            { id: 'bg_earthquake', nameKey: 'magic_panel.prompt.bg_earthquake', prompt: '背景修改为菲律宾地震后的城市街道，背景中楼房倒塌，道路裂开，蓝天白云。' },
        ]
    },
    {
        id: 'elements', nameKey: 'magic_panel.group.elements', prompts: [
            { id: 'element_rain', nameKey: 'magic_panel.prompt.element_rain', prompt: '为画面添加细雨蒙蒙的效果，雨丝清晰，带有湿润的氛围感。' },
            { id: 'element_snow', nameKey: 'magic_panel.prompt.element_snow', prompt: '为画面添加雪花飘落的场景，雪花形态优美，营造冬日氛围。' },
            { id: 'element_petals', nameKey: 'magic_panel.prompt.element_petals', prompt: '为画面添加飘落的粉色樱花花瓣，营造浪漫氛围。' },
            { id: 'element_leaves', nameKey: 'magic_panel.prompt.element_leaves', prompt: '为画面添加飘落的秋天枫叶，色彩为红色和黄色，营造秋日氛围。' },
            { id: 'element_fireflies', nameKey: 'magic_panel.prompt.element_fireflies', prompt: '为画面添加飞舞的萤火虫，发出柔和的黄绿色光芒，营造宁静的夏夜氛围。' },
            { id: 'element_particles', nameKey: 'magic_panel.prompt.element_particles', prompt: '为画面添加漂浮的金色光粒子，增加梦幻和神圣感。' },
            { id: 'element_flames', nameKey: 'magic_panel.prompt.element_flames', prompt: '在蒙版区域添加燃烧的橙色火焰，火焰形态逼真，有动态感。' },
            { id: 'element_sparkles', nameKey: 'magic_panel.prompt.element_sparkles', prompt: '为画面添加闪亮的星星或钻石般的光点，营造华丽、璀璨的效果。' },
            { id: 'element_rainbow', nameKey: 'magic_panel.prompt.element_rainbow', prompt: '在天空中添加一道美丽的彩虹，色彩鲜艳，过渡自然。' },
        ]
    },
    {
        id: 'style', nameKey: 'magic_panel.group.style', prompts: [
            { id: 'style_photography', nameKey: 'magic_panel.prompt.style_photography', prompt: '将图像转化为一张超现实的专业摄影作品。强调逼真的光影、景深和高分辨率细节。' },
            { id: 'style_illustration', nameKey: 'magic_panel.prompt.style_illustration', prompt: '将图像重绘为一幅充满想象力的插画，风格可以多样，但注重故事性和视觉吸引力。' },
            { id: 'style_vector', nameKey: 'magic_panel.prompt.style_vector', prompt: '将图像转换为平滑、干净的矢量艺术风格，具有清晰的轮廓和纯色填充，适合图形设计。' },
            { id: 'style_anime', nameKey: 'magic_panel.prompt.style_anime', prompt: '将整个画面重绘为色彩鲜艳、线条流畅的高品质日系动漫风格。' },
            { id: 'style_comic_book', nameKey: 'magic_panel.prompt.style_comic_book', prompt: '将图像重绘为经典美式漫画书风格，具有粗犷的轮廓线、半色调网点和动态的色彩。' },
            { id: 'style_oil_painting', nameKey: 'magic_panel.prompt.style_oil_painting', prompt: '将图像转变为古典油画风格，具有厚重的笔触和丰富的光影。' },
            { id: 'style_watercolor', nameKey: 'magic_panel.prompt.style_watercolor', prompt: '将图像转变为一幅水彩画，具有柔和的边缘、渗透的色彩和梦幻般的感觉。' },
            { id: 'style_acrylic', nameKey: 'magic_panel.prompt.style_acrylic', prompt: '将图像转变为一幅丙烯画，具有鲜艳的色彩、快速干燥的质感和明显的笔触。' },
            { id: 'style_sketch', nameKey: 'magic_panel.prompt.style_sketch', prompt: '将图像转变为铅笔素描风格，有清晰的线条和阴影。' },
            { id: 'style_colored_pencil_sketch', nameKey: 'magic_panel.prompt.style_colored_pencil_sketch', prompt: '将图像转变为一幅彩铅素描，具有细腻的笔触、柔和的色彩叠加和纸张的质感。' },
            { id: 'style_ink_wash', nameKey: 'magic_panel.prompt.style_ink_wash', prompt: '将图像转变为中国水墨画风格，有笔墨韵味和留白。' },
            { id: 'style_printmaking', nameKey: 'magic_panel.prompt.style_printmaking', prompt: '将图像转换为版画风格，模仿木刻或蚀刻技术，具有强烈的对比和独特的纹理。' },
            { id: 'style_linocut', nameKey: 'magic_panel.prompt.style_linocut', prompt: '将图像重塑为利诺剪裁版画风格，具有大胆的块状形状、手工雕刻的质感和简约的色彩。' },
            { id: 'style_ukiyo_e', nameKey: 'magic_panel.prompt.style_ukiyo_e', prompt: '将图像重绘为日本浮世绘风格，具有平面的色彩区域、独特的轮廓线和传统主题。' },
            { id: 'style_embroidery', nameKey: 'magic_panel.prompt.style_embroidery', prompt: '将图像转变为刺绣风格，具有线迹纹理和织物感。' },
            { id: 'style_sculpture', nameKey: 'magic_panel.prompt.style_sculpture', prompt: '将图像中的主体重新想象为一座三维雕塑，材质可以是石头、木头或金属，并具有逼真的光影和质感。' },
            { id: 'style_3d_render', nameKey: 'magic_panel.prompt.style_3d_render', prompt: '将图像转变为逼真的3D渲染效果，具有精细的纹理、逼真的光照和可信的深度感。' },
            { id: 'style_minimalist', nameKey: 'magic_panel.prompt.style_minimalist', prompt: '将图像简化为极简线条艺术，只用最少的线条和形状捕捉主体的精髓。' },
            { id: 'style_concept_art', nameKey: 'magic_panel.prompt.style_concept_art', prompt: '将图像重绘为一幅数字概念艺术作品，具有富有表现力的笔触和电影般的构图，用于电影或视频游戏。' },
            { id: 'style_pop_art', nameKey: 'magic_panel.prompt.style_pop_art', prompt: '将图像转换为波普艺术风格，使用鲜艳、大胆的色彩和重复的图案，类似安迪·沃霍尔的作品。' },
        ]
    },
    {
        id: 'filter', nameKey: 'magic_panel.group.filter', prompts: [
            { id: 'filter_birdsong_flowers', nameKey: 'magic_panel.prompt.filter_birdsong_flowers', prompt: '修改背景：鸟语花香，画面通透明亮' },
            { id: 'filter_dawn_seaside', nameKey: 'magic_panel.prompt.filter_dawn_seaside', prompt: '背景修改为金色神殿或教堂内部，圣光从高窗倾泻，\n空气中漂浮微尘与光晕，庄严而神圣。' },
            { id: 'filter_heavenly_realm', nameKey: 'magic_panel.prompt.filter_heavenly_realm', prompt: '背景修改为天国般的光辉空间，白云环绕，\n圣光从远处扩散，柔和而纯净，充满神圣氛围。' },
            { id: 'filter_holy_golden_radiance', nameKey: 'magic_panel.prompt.filter_holy_golden_radiance', prompt: '背景修改为被温柔金色光辉笼罩的空间，\n光线柔和细腻，如圣灵降临般神圣辉煌。' },
            { id: 'filter_dreamy_halo', nameKey: 'magic_panel.prompt.filter_dreamy_halo', prompt: '背景修改为柔光与色晕交织的梦幻空间，\n粉金蓝渐层，光线通透明亮，氛围温柔浪漫。' },
            { id: 'filter_starry_sky', nameKey: 'magic_panel.prompt.filter_starry_sky', prompt: '背景修改为璀璨星空与流光交织的夜幕，\n色彩深邃梦幻，带有神秘的宇宙气息。' },
            { id: 'filter_sky_sea_of_light', nameKey: 'magic_panel.prompt.filter_sky_sea_of_light', prompt: '背景修改为漂浮的云海与流动的光之海，\n柔光涌动，色彩通透明亮，空间感广阔神圣。' },
            { id: 'filter_sacred_flower_rain', nameKey: 'magic_panel.prompt.filter_sacred_flower_rain', prompt: '背景修改为光中飘落花瓣与金色微尘的圣洁场景，\n象征神恩降临与祝福，画面温柔唯美。' },
            { id: 'filter_pure_white_reflection', nameKey: 'magic_panel.prompt.filter_pure_white_reflection', prompt: '背景修改为纯白柔光中散发微微金辉的空间，\n光线清澈柔和，空气通透洁净，\n带来纯净、宁静与圣洁的感受。' },
            { id: 'filter_feather_light_space', nameKey: 'magic_panel.prompt.filter_feather_light_space', prompt: '背景修改为漂浮光羽与微尘的唯美空间，\n光线闪烁如星尘，空气温柔流动，\n带有诗意与灵性的静谧美感。' },
            { id: 'filter_rainbow_halo_realm', nameKey: 'magic_panel.prompt.filter_rainbow_halo_realm', prompt: '背景修改为彩晕与柔光交织的空间，\n光线呈粉金、珍珠白与浅蓝渐层，\n通透、安静、如天国般柔美。' },
            { id: 'filter_dreamy_sea_of_light', nameKey: 'magic_panel.prompt.filter_dreamy_sea_of_light', prompt: '背景修改为光影流动的梦幻海洋，\n柔光波动，空间无边，色彩柔和流畅，\n呈现极致唯美与神圣宁静感。' },
            { id: 'filter_pervading_holy_light', nameKey: 'magic_panel.prompt.filter_pervading_holy_light', prompt: '背景修改为被圣光完全笼罩的空间，\n光线自上而下倾泻，如柔雾与金辉交织，\n空间神圣纯净，充满安详与美感。' },
            { id: 'filter_golden_dust_space', nameKey: 'magic_panel.prompt.filter_golden_dust_space', prompt: '背景修改为空气中漂浮金色微尘的空间，\n光线温柔闪烁，明亮却不刺眼，\n营造出神圣与梦幻并存的氛围。' },
            { id: 'filter_platinum_soft_light_space', nameKey: 'magic_panel.prompt.filter_platinum_soft_light_space', prompt: '背景修改为白金色柔光流动的空间，\n空气中有细微光线颗粒闪动，\n画面极度纯净，神圣而高级。' },
            { id: 'filter_pure_light_dreamscape', nameKey: 'magic_panel.prompt.filter_pure_light_dreamscape', prompt: '背景修改为纯光构成的梦幻空间，\n无明显形体，仅有流动的柔和光色，\n整体如圣洁梦境般宁静唯美。' },
            { id: 'filter_light_of_heaven', nameKey: 'magic_panel.prompt.filter_light_of_heaven', prompt: '背景修改为充满纯净白金光线的天国空间，\n光线从远处延展，清澈而不耀眼，\n空气晶莹通透，画面高亮圣洁，带有神性与永恒感。' },
            { id: 'filter_pure_light_sanctuary', nameKey: 'magic_panel.prompt.filter_pure_light_sanctuary', prompt: '背景修改为由纯净光线构成的空间，\n光感清澈，层次分明，画面洁净无杂色，\n整体通透明亮，如天国的永恒光域。' },
            { id: 'filter_flowing_holy_radiance', nameKey: 'magic_panel.prompt.filter_flowing_holy_radiance', prompt: '背景修改为金白色与淡粉光辉交织的空间，\n光线自然流动，清晰明亮，\n呈现高贵、温柔与超凡的圣洁气息。' },
            { id: 'filter_realm_of_glory', nameKey: 'magic_panel.prompt.filter_realm_of_glory', prompt: '背景修改为笼罩在纯净金光中的空间，\n光线层叠细腻，反射柔和，\n营造庄严、华美、纯净而神圣的氛围。' },
            { id: 'filter_feather_light_sanctuary', nameKey: 'magic_panel.prompt.filter_feather_light_sanctuary', prompt: '背景修改为漂浮细光与闪亮光粒的明亮空间，\n光线通透流动，清晰柔亮，\n整体洁净纯美，带有灵性与平静。' },
            { id: 'filter_sea_of_golden_radiance', nameKey: 'magic_panel.prompt.filter_sea_of_golden_radiance', prompt: '背景修改为金色光线反射的光面空间，\n画面明亮透彻，层次细腻，\n呈现高贵庄严与天国般的明净氛围。' },
            { id: 'filter_holy_dome_light_field', nameKey: 'magic_panel.prompt.filter_holy_dome_light_field', prompt: '背景修改为穹顶形的纯光空间，\n线条柔顺、明亮清晰，光线集中于中心，\n营造出仿若神殿中的神圣明辉感。' },
            { id: 'filter_holy_flower_light_field', nameKey: 'magic_panel.prompt.filter_holy_flower_light_field', prompt: '背景修改为光线纯净的空间中漂浮着柔光花瓣，\n花色以白、金、淡粉为主，通透明亮，\n整体带有神圣、温柔与天国气息。' },
            { id: 'filter_flower_light_sanctuary', nameKey: 'magic_panel.prompt.filter_flower_light_sanctuary', prompt: '背景修改为被金白光辉笼罩的空间，\n细小花瓣与光粒在空气中轻盈散布，\n光线清澈柔亮，氛围高贵而神圣。' },
            { id: 'filter_holy_flower_crown_space', nameKey: 'magic_panel.prompt.filter_holy_flower_crown_space', prompt: '背景修改为由花朵与光线交织形成的环形光带，\n花色洁净柔和，整体通透明亮，\n呈现出天国般庄严与纯美的气质。' },
            { id: 'filter_feather_light_flower_rain', nameKey: 'magic_panel.prompt.filter_feather_light_flower_rain', prompt: '背景修改为清澈空间中轻盈落下的花瓣与光羽，\n光感晶莹，色调柔亮纯净，\n带有祝福般的神圣浪漫感。' },
            { id: 'filter_sea_of_flowers_in_light', nameKey: 'magic_panel.prompt.filter_sea_of_flowers_in_light', prompt: '背景修改为沐浴在纯净金白光中的花海远景，\n花朵仿若光之化身，色调明快通透，\n带有天国般的静谧与庄严。' },
            { id: 'filter_heavenly_flower_realm', nameKey: 'magic_panel.prompt.filter_heavenly_flower_realm', prompt: '背景修改为光与花交织的神圣空间，\n花色柔和纯净，金光映照其上，\n整体氛围清亮唯美，极具神性与安宁感。' },
            { id: 'filter_source_of_holy_radiance', nameKey: 'magic_panel.prompt.filter_source_of_holy_radiance', prompt: '背景修改为光线汇聚成的明亮中心，\n白金光自内向外流动，清澈无杂，\n整体高贵、神圣、通透明亮。' },
            { id: 'filter_realm_of_purity', nameKey: 'magic_panel.prompt.filter_realm_of_purity', prompt: '背景修改为完全由白与金色光构成的空间，\n无任何杂质或阴影，\n通透明亮，静谧高洁，仿若圣光之源。' },
            { id: 'filter_holy_bright_space', nameKey: 'magic_panel.prompt.filter_holy_bright_space', prompt: '背景修改为纯白空间中闪耀微光的光域，\n光线干净、均匀、无雾感，\n呈现绝对纯净与平和的美感。' },
            { id: 'filter_ultimate_golden_radiance', nameKey: 'magic_panel.prompt.filter_ultimate_golden_radiance', prompt: '背景修改为被金色柔光环绕的通透空间，\n光线明亮不刺眼，反射细腻，\n画面庄严而温柔，充满神性。' },
            { id: 'filter_eternal_white_light_field', nameKey: 'magic_panel.prompt.filter_eternal_white_light_field', prompt: '背景修改为纯白无垢的光域，\n光线均匀散射，空气透亮如玻璃，\n呈现极简、神圣与永恒的视觉纯度。' },
            { id: 'filter_overture_of_light', nameKey: 'magic_panel.prompt.filter_overture_of_light', prompt: '背景修改为由柔光构成的抽象空间，\n光层叠交错，节奏柔和自然，\n呈现纯净、灵性与艺术的和谐美感。' },
            { id: 'filter_heavenly_heart_light_source', nameKey: 'magic_panel.prompt.filter_heavenly_heart_light_source', prompt: '背景修改为中心放射的纯净光源空间，\n光线明亮柔和，带有安详的天国气息，\n整体平衡、纯洁而庄重。' },
            { id: 'filter_light_of_holy_spirit', nameKey: 'magic_panel.prompt.filter_light_of_holy_spirit', prompt: '背景修改为柔和白金光环围绕的空间，\n光线纯净通透，充满灵性气息，\n呈现出神圣、宁静与美的极致融合。' },
        ]
    }
];

const readStoredPresetUser = () => {
    if (typeof window === 'undefined') return '';
    try {
        return localStorage.getItem('app_preset_user') || '';
    } catch {
        return '';
    }
};

const LEGACY_MAGIC_SHEET_CONFIG = {
    sheetId: '1InDrlrypvb_5xwtNCmqYIUuWL5cm7YNbBaCvJuEY9D0',
    sheetName: 'MagicCommands',
    submitUrl: DEFAULT_PRESET_SUBMIT_URL
};

const isValidGmail = (value: string) => /^[a-zA-Z0-9](?:[a-zA-Z0-9_.+-]*[a-zA-Z0-9])?@gmail\.com$/i.test(value.trim());

type MagicSaveStatus = {
    type: 'success' | 'error';
    message: string;
};

interface MagicPanelProps {
    onMagicPromptSelect: (prompt: string) => void;
    presetUser?: string;
    registerSaveHandler?: (handler: (() => void) | null) => void;
    onSaveStatusChange?: (status: MagicSaveStatus | null) => void;
}

export const MagicPanel: React.FC<MagicPanelProps> = ({
    onMagicPromptSelect,
    presetUser: presetUserProp,
    registerSaveHandler,
    onSaveStatusChange
}) => {
    const { t } = useContext(AppContext);
    const [magicGroups, setMagicGroups] = useState<MagicGroup[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    
    const [isEditing, setIsEditing] = useState(false);
    const [editingPromptState, setEditingPromptState] = useState<{groupId: string, prompt: MagicPrompt} | null>(null);
    const [editName, setEditName] = useState('');
    const [editText, setEditText] = useState('');

    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingGroupName, setEditingGroupName] = useState('');

    const [isAddingGroup, setIsAddingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    
    const [isAddingPrompt, setIsAddingPrompt] = useState(false);
    const [newPromptName, setNewPromptName] = useState('');

    const fallbackPresetUserRef = useRef<string>(readStoredPresetUser());
    const presetUser = (presetUserProp ?? fallbackPresetUserRef.current) ?? '';
    const [, setIsSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState<string | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isSaveConfirmOpen, setIsSaveConfirmOpen] = useState(false);
    const [skipSaveConfirm, setSkipSaveConfirm] = useState(() => getShouldSkipPresetSaveConfirm());
    const [dontAskAgain, setDontAskAgain] = useState(false);
    const pendingSaveActionRef = useRef<(() => void) | null>(null);
    const lastSyncedUserRef = useRef<string | null>(null);

    const importInputRef = useRef<HTMLInputElement>(null);
    const addGroupInputRef = useRef<HTMLInputElement>(null);
    const addPromptInputRef = useRef<HTMLInputElement>(null);
    const groupInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        try {
            const storedGroups = localStorage.getItem('magic-commands');
            if (storedGroups) {
                const parsed = JSON.parse(storedGroups);
                setMagicGroups(parsed);
                if (!activeTabId && parsed.length > 0) {
                    setActiveTabId(parsed[0].id);
                }
            } else {
                setMagicGroups(DEFAULT_PRESET_GROUPS);
                setActiveTabId(DEFAULT_PRESET_GROUPS[0]?.id);
            }
        } catch (error) {
            console.error("Failed to load magic commands from localStorage", error);
            setMagicGroups(DEFAULT_PRESET_GROUPS);
            setActiveTabId(DEFAULT_PRESET_GROUPS[0]?.id);
        }
    }, [activeTabId]);

    useEffect(() => {
        if (editingPromptState) {
          setEditName(t(editingPromptState.prompt.nameKey as any, { defaultValue: editingPromptState.prompt.nameKey }));
          setEditText(editingPromptState.prompt.prompt);
        }
    }, [editingPromptState, t]);

    useEffect(() => {
        if (editingGroupId && groupInputRef.current) {
            groupInputRef.current.focus();
        }
    }, [editingGroupId]);
    
    useEffect(() => {
        if (isAddingGroup && addGroupInputRef.current) {
            addGroupInputRef.current.focus();
        }
    }, [isAddingGroup]);

    useEffect(() => {
        if (isAddingPrompt && addPromptInputRef.current) {
            addPromptInputRef.current.focus();
        }
    }, [isAddingPrompt]);

    useEffect(() => {
        if(magicGroups.length > 0) {
            localStorage.setItem('magic-commands', JSON.stringify(magicGroups));
        }
    }, [magicGroups]);

    useEffect(() => {
        setSaveMessage(null);
        setSaveError(null);
    }, [presetUser]);

    const activeGroup = magicGroups.find(g => g.id === activeTabId);
    const statusMessage = saveError || syncError || saveMessage || syncMessage;
    const statusClass = (saveError || syncError) ? 'text-red-500' : 'text-[var(--color-indigo)]';
    const confirmUserLabel = presetUser.trim() || t('magic_panel.user_placeholder');

    const handleSavePrompt = () => {
        if (!editingPromptState) return;
        setMagicGroups(prev => prev.map(g => g.id === editingPromptState.groupId ? {
            ...g,
            prompts: g.prompts.map(p => p.id === editingPromptState.prompt.id ? {...p, nameKey: editName, prompt: editText} : p)
        } : g));
        setEditingPromptState(null);
    };

    const handleSaveGroupName = () => {
        if (!editingGroupId || !editingGroupName.trim()) {
            setEditingGroupId(null);
            return;
        }
        setMagicGroups(prev => prev.map(g => g.id === editingGroupId ? {
            ...g,
            nameKey: editingGroupName.trim()
        } : g));
        setEditingGroupId(null);
    };
    
    const handleAddGroup = () => {
        if (newGroupName.trim()) {
            const newGroup: MagicGroup = {
                id: `group-${Date.now()}`,
                nameKey: newGroupName.trim(),
                prompts: []
            };
            setMagicGroups(prev => [...prev, newGroup]);
            setActiveTabId(newGroup.id);
        }
        setNewGroupName('');
        setIsAddingGroup(false);
    };

    const handleAddPrompt = () => {
        if (newPromptName.trim() && activeTabId) {
             const newPrompt: MagicPrompt = {
                id: `prompt-${Date.now()}`,
                nameKey: newPromptName.trim(),
                prompt: '在这里输入你的新指令...'
            };
            setMagicGroups(prev => prev.map(g => g.id === activeTabId ? {
                ...g,
                prompts: [...g.prompts, newPrompt]
            } : g));
        }
        setNewPromptName('');
        setIsAddingPrompt(false);
    };
    
    const handleDeleteGroup = (groupId: string) => {
      setMagicGroups(prev => {
          const newGroups = prev.filter(g => g.id !== groupId);
          if (activeTabId === groupId) {
              setActiveTabId(newGroups[0]?.id || null);
          }
          return newGroups;
      });
    };

    const handleDeletePrompt = (groupId: string, promptId: string) => {
        setMagicGroups(prev => prev.map(g => g.id === groupId ? {
            ...g,
            prompts: g.prompts.filter(p => p.id !== promptId)
        } : g));
    }

    const handleSyncFromSheet = useCallback(async () => {
        const user = presetUser.trim();
        if (!user) {
            setSyncError(t('magic_panel.user_required'));
            setSyncMessage(null);
            return;
        }
        if (!isValidGmail(user)) {
            setSyncError(t('magic_panel.user_invalid'));
            setSyncMessage(null);
            return;
        }

        setIsSyncing(true);
        setSyncError(null);
        setSyncMessage(null);

        try {
            let scopedRows: ReturnType<typeof extractScopedRows> = [];
            let sharedFetchError: Error | null = null;
            try {
                const rows = await fetchUserPresetsFromSheet(user, SHARED_PRESET_SHEET_CONFIG);
                scopedRows = extractScopedRows(rows, PRESET_SCOPE_MAGIC);
            } catch (err) {
                sharedFetchError = err instanceof Error ? err : new Error(String(err));
            }

            if (!scopedRows.length) {
                try {
                    scopedRows = await fetchUserPresetsFromSheet(user, LEGACY_MAGIC_SHEET_CONFIG);
                } catch (legacyErr) {
                    console.warn('Legacy magic commands sheet fetch failed:', legacyErr);
                }
            }

            if (!scopedRows.length) {
                if (sharedFetchError) {
                    setSyncError(sharedFetchError.message || t('magic_panel.sync_error'));
                } else {
                    setSyncMessage(t('magic_panel.sheet_empty'));
                }
                return;
            }

            const grouped = new Map<string, MagicGroup>();
            scopedRows
                .sort((a, b) => {
                    const catOrder = (a.categoryOrder ?? 0) - (b.categoryOrder ?? 0);
                    if (catOrder !== 0) return catOrder;
                    return (a.presetOrder ?? 0) - (b.presetOrder ?? 0);
                })
                .forEach(row => {
                    const category = row.category || t('magic_panel.default_category');
                    const groupId = `sheet-${category}`.toLowerCase().replace(/\s+/g, '-');
                    if (!grouped.has(groupId)) {
                        grouped.set(groupId, { id: groupId, nameKey: category, prompts: [] });
                    }
                    const target = grouped.get(groupId)!;
                    target.prompts.push({
                        id: `sheet-${row.presetLabel || 'prompt'}-${Date.now()}-${target.prompts.length}`,
                        nameKey: row.presetLabel || t('magic_panel.default_prompt'),
                        prompt: row.prompt
                    });
                });

            const nextGroups = Array.from(grouped.values());
            setMagicGroups(nextGroups);
            setActiveTabId(nextGroups[0]?.id || null);
            setSyncMessage(t('magic_panel.sync_success', { count: scopedRows.length.toString() }));
        } catch (err: any) {
            console.error('Sync magic commands from sheet failed:', err);
            setSyncError(err?.message || t('magic_panel.sync_error'));
        } finally {
            setIsSyncing(false);
        }
    }, [presetUser, t]);

    useEffect(() => {
        if (!presetUser) {
            lastSyncedUserRef.current = null;
            return;
        }
        if (!isValidGmail(presetUser)) {
            lastSyncedUserRef.current = null;
            return;
        }
        const normalized = presetUser.trim().toLowerCase();
        if (lastSyncedUserRef.current === normalized) {
            return;
        }
        lastSyncedUserRef.current = normalized;
        handleSyncFromSheet();
    }, [presetUser, handleSyncFromSheet]);
    
    const handleExport = () => {
        const dataStr = JSON.stringify(magicGroups, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = 'magic-commands.json';
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    };

    const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const fileReader = new FileReader();
        if (e.target.files && e.target.files[0]) {
            fileReader.readAsText(e.target.files[0], "UTF-8");
            fileReader.onload = e => {
                try {
                    const content = e.target?.result;
                    if (typeof content === 'string') {
                        const importedGroups = JSON.parse(content);
                        if (Array.isArray(importedGroups)) {
                            if (confirm(t('magic_panel.confirm_import'))) {
                                setMagicGroups(importedGroups);
                                setActiveTabId(importedGroups[0]?.id || null);
                            }
                        } else {
                            throw new Error("Invalid format");
                        }
                    }
                } catch (error) {
                    alert(t('magic_panel.import_error'));
                    console.error("Import failed:", error);
                }
            };
        }
         if (importInputRef.current) {
            importInputRef.current.value = "";
        }
    };

    const getSheetRowsFromGroups = useCallback(() => {
        return magicGroups.flatMap((group, groupIndex) => {
            const categoryLabel = (t(group.nameKey as any, { defaultValue: group.nameKey }) || group.nameKey).trim() || group.nameKey;
            const scopedCategory = encodeScopedCategory(PRESET_SCOPE_MAGIC, categoryLabel);
            return group.prompts
                .map((prompt, promptIndex) => {
                    const label = (t(prompt.nameKey as any, { defaultValue: prompt.nameKey }) || prompt.nameKey).trim();
                    const promptText = (prompt.prompt || '').trim();
                    if (!label || !promptText) return null;
                    return {
                        category: scopedCategory,
                        presetLabel: label,
                        prompt: promptText,
                        categoryOrder: groupIndex + 1,
                        presetOrder: promptIndex + 1
                    };
                })
                .filter((row): row is NonNullable<typeof row> => !!row);
        });
    }, [magicGroups, t]);

    const requestSaveConfirmation = (action: () => void) => {
        if (skipSaveConfirm) {
            action();
            return;
        }
        pendingSaveActionRef.current = action;
        setDontAskAgain(false);
        setIsSaveConfirmOpen(true);
    };

    const handleConfirmSave = () => {
        setIsSaveConfirmOpen(false);
        if (dontAskAgain && !skipSaveConfirm) {
            setShouldSkipPresetSaveConfirm(true);
            setSkipSaveConfirm(true);
        }
        const action = pendingSaveActionRef.current;
        pendingSaveActionRef.current = null;
        action?.();
    };

    const handleCancelSaveConfirm = () => {
        setIsSaveConfirmOpen(false);
        pendingSaveActionRef.current = null;
        setDontAskAgain(false);
    };

    const handleSaveToSheet = useCallback(() => {
        if (isSaving) return;
        const user = presetUser.trim();
        if (!user) {
            setSaveError(t('magic_panel.user_required'));
            setSaveMessage(null);
            return;
        }
        if (!isValidGmail(user)) {
            setSaveError(t('magic_panel.user_invalid'));
            setSaveMessage(null);
            return;
        }

        const rows = getSheetRowsFromGroups();
        if (!rows.length) {
            setSaveError(t('magic_panel.save_no_data'));
            setSaveMessage(null);
            return;
        }

        const executeSave = async () => {
            setIsSaving(true);
            setSaveError(null);
            setSaveMessage(null);
            try {
                await savePresetRowsToSheet({
                    userName: user,
                    rows,
                    config: SHARED_PRESET_SHEET_CONFIG,
                    ensureHeaderRow: true
                });
                setSaveMessage(t('magic_panel.save_success'));
            } catch (err: any) {
                console.error('Save magic commands failed:', err);
                setSaveError(err?.message || t('magic_panel.save_error'));
            } finally {
                setIsSaving(false);
            }
        };

        requestSaveConfirmation(executeSave);
    }, [presetUser, t, getSheetRowsFromGroups, isSaving, requestSaveConfirmation]);

    useEffect(() => {
        registerSaveHandler?.(handleSaveToSheet);
        return () => registerSaveHandler?.(null);
    }, [registerSaveHandler, handleSaveToSheet]);

    useEffect(() => {
        if (!onSaveStatusChange) return;
        if (saveError) {
            onSaveStatusChange({ type: 'error', message: saveError });
        } else if (saveMessage) {
            onSaveStatusChange({ type: 'success', message: saveMessage });
        } else {
            onSaveStatusChange(null);
        }
    }, [saveError, saveMessage, onSaveStatusChange]);

    return (
        <div className="flex-grow flex flex-col overflow-hidden relative">
                <div className="p-4 pb-2 flex-shrink-0 flex flex-col gap-2">
                <div className="flex justify-between items-center gap-3 flex-wrap">
                    <h2 className="text-lg font-bold">{t('magic_panel.title')}</h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        <label className="flex items-center cursor-pointer">
                            <span className="text-sm mr-2">{t('common.edit')}</span>
                            <div className="relative">
                                <input type="checkbox" checked={isEditing} onChange={() => setIsEditing(!isEditing)} className="sr-only" />
                                <div className={`block w-10 h-6 rounded-full ${isEditing ? 'bg-[var(--color-indigo)]' : 'bg-gray-600'}`}></div>
                                <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${isEditing ? 'translate-x-full' : ''}`}></div>
                            </div>
                        </label>
                        <div className="flex items-center gap-2">
                            <input type="file" accept=".json" onChange={handleImport} ref={importInputRef} className="hidden" />
                            <button onClick={() => importInputRef.current?.click()} className="px-3 py-1.5 rounded-md bg-[var(--color-bg-contrast)] hover:opacity-80 text-xs">
                                {t('common.import')}
                            </button>
                            <button onClick={handleExport} className="px-3 py-1.5 rounded-md bg-[var(--color-bg-contrast)] hover:opacity-80 text-xs">
                                {t('common.export')}
                            </button>
                        </div>
                    </div>
                </div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                    {t('magic_panel.save_notice')}
                    {statusMessage && (
                        <div className={`mt-1 ${statusClass}`}>
                            {statusMessage}
                        </div>
                    )}
                </div>
             </div>
             <div className="flex flex-col flex-grow overflow-hidden">
                <div className="flex-shrink-0 border-b border-[var(--color-border)] px-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        {magicGroups.map(group => (
                            <div key={group.id} className="relative group/tab">
                                {editingGroupId === group.id ? (
                                    <input
                                        ref={groupInputRef}
                                        type="text"
                                        value={editingGroupName}
                                        onChange={(e) => setEditingGroupName(e.target.value)}
                                        onBlur={handleSaveGroupName}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSaveGroupName()}
                                        className="px-3 py-2 text-sm font-medium bg-transparent border-b-2 border-[var(--color-indigo)] text-[var(--color-indigo)] focus:outline-none w-24"
                                    />
                                ) : (
                                    <button
                                        onClick={() => setActiveTabId(group.id)}
                                        className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTabId === group.id ? 'border-[var(--color-indigo)] text-[var(--color-indigo)]' : 'border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'}`}
                                    >
                                        {t(group.nameKey as any, {defaultValue: group.nameKey})}
                                    </button>
                                )}
                                 {isEditing && editingGroupId !== group.id && (
                                    <div className="absolute -top-1 -right-1 flex items-center gap-1 opacity-0 group-hover/tab:opacity-100 z-10">
                                        <button onClick={() => { setEditingGroupId(group.id); setEditingGroupName(t(group.nameKey as any, {defaultValue: group.nameKey})); }} className="p-1 bg-blue-500 rounded text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg></button>
                                        <button onClick={() => handleDeleteGroup(group.id)} className="p-1 bg-red-500 rounded text-white flex items-center justify-center h-5 w-5"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex-grow p-4 overflow-y-auto">
                    <div className="flex flex-row flex-wrap gap-2">
                        {activeGroup?.prompts.map(prompt => (
                            <div key={prompt.id} className="relative group/prompt">
                                <button 
                                    onClick={() => onMagicPromptSelect(prompt.prompt)}
                                    disabled={isEditing}
                                    className="px-3 py-2 rounded-md bg-[var(--color-bg-tertiary)] hover:bg-[var(--color-bg-contrast)] transition-colors text-left text-sm disabled:cursor-not-allowed"
                                >
                                    {t(prompt.nameKey as any, { defaultValue: prompt.nameKey })}
                                </button>
                                {isEditing && (
                                    <div className="absolute -top-1 -right-1 flex items-center gap-1 opacity-0 group-hover/prompt:opacity-100 z-10">
                                        <button onClick={() => { setEditingPromptState({groupId: activeGroup.id, prompt: prompt}); }} className="p-1 bg-blue-500 rounded text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg></button>
                                        <button onClick={() => handleDeletePrompt(activeGroup.id, prompt.id)} className="p-1 bg-red-500 rounded text-white"><svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                                    </div>
                                )}
                            </div>
                        ))}
                         {isEditing && activeGroup && !isAddingPrompt && (
                            <button onClick={() => setIsAddingPrompt(true)} className="px-3 py-2 rounded-md border-2 border-dashed border-[var(--color-bg-contrast)] hover:bg-[var(--color-bg-contrast)] text-sm text-[var(--color-text-secondary)]">
                                + {t('magic_panel.add_prompt')}
                            </button>
                        )}
                        {isEditing && isAddingPrompt && (
                            <div className="p-2 border border-dashed border-[var(--color-border)] rounded-md w-full">
                                <input 
                                  ref={addPromptInputRef}
                                  type="text" 
                                  value={newPromptName}
                                  onChange={(e) => setNewPromptName(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleAddPrompt()}
                                  onBlur={() => { if(!newPromptName) setIsAddingPrompt(false); }}
                                  placeholder={t('magic_panel.enter_prompt_name')}
                                  className="w-full bg-black/20 text-sm p-2 rounded border border-[var(--color-border)]"
                                />
                                <div className="flex justify-end gap-2 mt-2">
                                    <button onClick={() => setIsAddingPrompt(false)} className="px-2 py-1 text-xs rounded bg-gray-500">{t('common.cancel')}</button>
                                    <button onClick={handleAddPrompt} className="px-2 py-1 text-xs rounded bg-[var(--color-indigo)]">{t('common.save')}</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                <div className="p-4 border-t border-[var(--color-border)] flex-shrink-0 space-y-2">
                   {isEditing && !isAddingGroup ? (
                       <button onClick={() => setIsAddingGroup(true)} className="w-full p-2 rounded-md bg-[var(--color-bg-contrast)] hover:opacity-80 text-sm">
                           + {t('magic_panel.add_group')}
                        </button>
                   ) : isEditing && isAddingGroup ? (
                       <input 
                            ref={addGroupInputRef}
                            type="text"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddGroup()}
                            onBlur={handleAddGroup}
                            placeholder={t('magic_panel.enter_group_name')}
                            className="w-full bg-black/20 text-sm p-2 rounded border border-[var(--color-border)]"
                       />
                   ) : null}
                </div>
             </div>
             
            {editingPromptState && (
                <div 
                    className="absolute inset-0 bg-black/60 flex items-center justify-center z-20"
                    onClick={() => setEditingPromptState(null)}
                >
                    <div 
                        className="bg-[var(--color-bg-secondary)] p-4 rounded-lg shadow-2xl border border-[var(--color-border)] w-[calc(100%-2rem)]"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3 className="text-base font-semibold mb-3 text-center">{t('magic_panel.edit_prompt')}</h3>
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder={t('magic_panel.enter_prompt_name')}
                            className="w-full bg-[var(--color-bg)] text-sm p-2 rounded border border-[var(--color-border)] mb-2 focus:ring-2 focus:ring-[var(--color-indigo)]"
                        />
                        <textarea 
                            value={editText} 
                            onChange={(e) => setEditText(e.target.value)} 
                            rows={6} 
                            className="w-full bg-[var(--color-bg)] text-sm p-2 rounded border border-[var(--color-border)] resize-none focus:ring-2 focus:ring-[var(--color-indigo)]" 
                        />
                        <div className="flex justify-end gap-2 mt-2">
                            <button onClick={() => setEditingPromptState(null)} className="px-3 py-1.5 text-sm rounded bg-gray-600 hover:bg-gray-500">{t('common.cancel')}</button>
                            <button onClick={handleSavePrompt} className="px-3 py-1.5 text-sm rounded bg-[var(--color-indigo)] hover:bg-[var(--color-indigo-hover)]">{t('common.save')}</button>
                        </div>
                    </div>
                </div>
            )}
            <ConfirmDialog
                open={isSaveConfirmOpen}
                title={t('magic_panel.save_confirm_title')}
                description={t('magic_panel.save_confirm_desc', { user: confirmUserLabel })}
                confirmLabel={t('magic_panel.save_confirm_confirm')}
                cancelLabel={t('common.cancel')}
                dontAskLabel={t('magic_panel.save_confirm_skip')}
                dontAskChecked={dontAskAgain}
                onDontAskChange={setDontAskAgain}
                onConfirm={handleConfirmSave}
                onCancel={handleCancelSaveConfirm}
            />
        </div>
    );
};
