'use strict';

import { app } from "../../../scripts/app.js"; // For LiteGraph

import { addGroupVersionToGraph, updateGroupFromJSONData } from "./utils.js";

import VersionManager from "./versionManager.js";
const versionManager = new VersionManager();

var initialGroupNodeRecomputed = false;
const groupInitialVersioningData = new WeakMap();

async function saveGroup(menuItem, options, e, menu, groupNode, saveAsNew) {
    const groupHasVersioningData = groupNode.versioning_data !== undefined;

    const groupData = {
        versioning_data: groupNode.versioning_data
    };
    // Get component name if needed
    if (!groupHasVersioningData) {
        const componentName = prompt("Enter the component name:");
        if (!componentName) {
            return;
        }
        groupData.versioning_data = { object_name: componentName };
    }

    // Get group nodes
    groupData.nodes = groupNode._nodes.map(node => {
        return node.serialize();
    });

    // Process and remove links that are not between group nodes
    {
        const groupLinkIds = new Set([]);
        // TODO: Make sure that we're not saving links that are not between group nodes
        const groupNodeIds = groupNode._nodes.map(node => node.id);
        for (const node of groupNode._nodes) {
            if (node.inputs) {
                node.inputs.forEach(input => {
                    if (input.link) {
                        groupLinkIds.add(input.link);
                    }
                });
            }

            if (node.outputs) {
                node.outputs.forEach(output => {
                    if (output.links) {
                        output.links.forEach(link => {
                            groupLinkIds.add(link);
                        });
                    }
                });
            }
        }
        groupData.links = Array.from(groupLinkIds).map(linkId => {
            let linkIndex = -1;
            if (typeof app.graph.links === 'object') {
                Object.keys(app.graph.links).forEach(link => {
                    if (app.graph.links[link].id === linkId) {
                        linkIndex = linkId;
                    }
                });
            }
            else {
                linkIndex = app.graph.links.findIndex(link => {
                    return link ? link.id === linkId : false;
                });
            }
            if (linkIndex === -1) {
                return null;
            }
            return app.graph.links[linkIndex].serialize();
        }).filter(link => link !== null);
    }

    // Add group data
    groupData.group = groupNode.serialize();

    const jsonData = await versionManager.saveGroupData(groupData, saveAsNew);
    if (jsonData.error) {
        console.error(jsonData.error);
        return;
    }
    
    updateGroupFromJSONData(groupNode, jsonData);
    app.graph.setDirtyCanvas(true, true);
}

function saveGroupAsNewVersion(menuItem, options, e, menu, groupNode) {
    const saveAsNew = true;
    saveGroup(menuItem, options, e, menu, groupNode, saveAsNew);
}

async function loadGroup(menuItem, options, e, menu, groupNode) {
    const data = await versionManager.loadGroupData(menuItem.extra.group.id);
    if (data["versions"].length === 0) {
        return;
    }

    addGroupVersionToGraph(app, data, groupNode, menuItem.extra.touchPos, menuItem.extra.groupVersion, menuItem.extra.refresh);
}

function extendCanvasMenu() {
    const oldProcessContextMenu = LGraphCanvas.prototype.processContextMenu;
    LGraphCanvas.prototype.processContextMenu = function(node, event) {
        var group = app.graph.getGroupOnPos(
            event.canvasX,
            event.canvasY
        );
        const touchPos = [event.canvasX, event.canvasY];
        if (!group) {
            const oldCanvasMenu = LGraphCanvas.prototype.getCanvasMenuOptions;
            LGraphCanvas.prototype.getCanvasMenuOptions = function() {
                const enhancedCanvasMenu = oldCanvasMenu.apply(this, arguments);
                const index = enhancedCanvasMenu.findIndex((o) => o?.content === "Add Group");
                if (index === -1) {
                    return enhancedCanvasMenu;
                }

                enhancedCanvasMenu[index] = {
                    content: "Add Group", has_submenu: true, submenu: {
                        title: "Add Group",
                        options: [
                            { content: "Empty group", callback: LGraphCanvas.onGroupAdd },
                            {
                                content: "Versioned group", has_submenu: true, submenu: {
                                    title: "Groups",
                                    options: versionManager.versionedGroups().map(group => {
                                        const latestVersion = group.versions[0];
                                        const groupTitle = `${group.name} (v${latestVersion.id})`;
                                        return { content: groupTitle, callback: loadGroup, extra: { group, touchPos, groupVersion: latestVersion } };
                                    }),
                                }
                            },
                        ],
                    }
                };
                
                return enhancedCanvasMenu;
            };
        }   

        oldProcessContextMenu.apply(this, arguments);
    };
}

function extendGroupContextMenu() {

    const oldGroupContextMenu = LGraphCanvas.prototype.getGroupMenuOptions;
    LGraphCanvas.prototype.getGroupMenuOptions = function(group) {
        var enhancedContextMenu = oldGroupContextMenu(group);
        enhancedContextMenu.push(null);

        const groupHasVersioningData = group.versioning_data !== undefined;
        const submenuOptions = [
            { content: "Save", callback: saveGroup },
        ];
        if (groupHasVersioningData) {
            let optionsObjects = [];
            const groupIndex = versionManager.versionedGroups().findIndex(obj => obj.id === group.versioning_data.object_id);
            let currentGroupData = null;
            if (groupIndex !== -1) {
                currentGroupData = versionManager.versionedGroups()[groupIndex];
                optionsObjects = currentGroupData.versions.map(groupVersion => {
                    const lastModificationDatetime = new Date(groupVersion.timestamp).toLocaleString();
                    const groupTitle = `v${groupVersion.id} [${lastModificationDatetime}]`;
                    return { content: groupTitle, callback: loadGroup, extra: { group: currentGroupData, touchPos: undefined, groupVersion } };
                });
            }
            if (!currentGroupData || !currentGroupData.versions || currentGroupData.versions.length === 0) {
                return enhancedContextMenu;
            }
            const currentGroupVersion = currentGroupData.versions.find(v => v.id === group.versioning_data.object_version);
            const versionedGroupOptions = [
                { content: "Save as new version", callback: saveGroupAsNewVersion },
                null,
                {
                    content: "Load version", has_submenu: true, submenu: {
                        title: "Available Versions",
                        extra: group,
                        options: optionsObjects
                    }
                },
                { content: "Refresh", callback: loadGroup, extra: { group: currentGroupData, touchPos: undefined, groupVersion: currentGroupVersion, refresh: true } },
            ];
            submenuOptions.push(...versionedGroupOptions);
        }
        const versionControlMenu = {
            content: "Versions",
            has_submenu: true,
            submenu: {
                title: "Version Control",
                extra: group,
                options: submenuOptions
            },
        };
        enhancedContextMenu.push(versionControlMenu);
        return enhancedContextMenu;
    };
}

function extendGroupDrawingContext() {
    const drawGroups = LGraphCanvas.prototype.drawGroups;
    LGraphCanvas.prototype.drawGroups = function(canvas, ctx) {
        drawGroups.apply(this, arguments);
        if (!app.graph) {
            return;
        }

        var groups = app.graph._groups;

        ctx.save();
        ctx.globalAlpha = 0.5 * app.editor_alpha;

        for (var i = 0; i < groups.length; ++i) {
            var group = groups[i];

            if (!app.canvas ||
                !LiteGraph.overlapBounding(app.canvas.visible_area, group._bounding) ||
                !group.versioning_data
            ) {
                continue;
            }

            ctx.fillStyle = group.color || "#335";
            ctx.strokeStyle = group.color || "#335";
            var pos = group._pos;
            var size = group._size;
            var font_size = group.font_size || LiteGraph.DEFAULT_GROUP_FONT_SIZE;
        
            ctx.font = (font_size - 10) + "px Arial";
            ctx.textAlign = "right";
            const infoText = `[${group.versioning_data.object_name} (v${group.versioning_data.object_version})]`;
            ctx.fillText(infoText, pos[0] - 4 + size[0], pos[1] + font_size);
        }
        ctx.restore();
    }
}

export function setupConfigAndSerialization() {

    function removeVersioningDataIfNeeded(groupNode) {
        // In case we've loaded a versioned group which doesn't have history
        // in the version manager (e.g. a workflow was transferred from another
        // machine without the respective JSON file), we should remove the
        // versioning data and make it behave as a regular group.
        if (groupNode.versioning_data && !versionManager.versionedGroups().find(obj => obj.id === groupNode.versioning_data.object_id)) {
            delete groupNode.versioning_data;
        }
        app.graph.setDirtyCanvas(true, true);
    }

    const serialize = LGraphGroup.prototype.serialize;
    LGraphGroup.prototype.serialize = function() {
        if (!initialGroupNodeRecomputed) {
            this.recomputeInsideNodes();
            initialGroupNodeRecomputed = true;
        }
        const object = serialize.apply(this, arguments);
        if (this.versioning_data) {
            const versioningData = {
                object_id: this.versioning_data?.object_id || null,
                object_name: this.versioning_data?.object_name || null,
                object_version: this.versioning_data?.object_version || null,
            };
            object.versioning_data = versioningData;
        }
        else if (groupInitialVersioningData.has(this)) {
            const initialVersioningData = groupInitialVersioningData.get(this);
            const versioningData = {
                object_id: initialVersioningData.object_id || null,
                object_name: initialVersioningData.object_name || null,
                object_version: initialVersioningData.object_version || null,
            };
            this.versioning_data = versioningData;
            object.versioning_data = versioningData;
        }
        removeVersioningDataIfNeeded(object);
        return object;
    };

    const configure = LGraphGroup.prototype.configure;
    LGraphGroup.prototype.configure = function(data) {
        configure.apply(this, arguments);
        if (data.versioning_data) {
            groupInitialVersioningData.set(this, data.versioning_data);
            this.versioning_data = data.versioning_data;
        }
        removeVersioningDataIfNeeded(this);
    };
}

export async function registerGroupExtensions() {
    extendGroupDrawingContext();
    await versionManager.loadVersionedGroups();

    extendGroupContextMenu();
    extendCanvasMenu();
}
