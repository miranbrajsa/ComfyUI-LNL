'use strict';

import { fetchGroupsData } from "./utils.js";

export default class VersionManager {
    
    // constructor() {
    //     this.version = 0;
    //     this.versionKey = 'EnhancedGroupsVersion';
    //     this.version = parseInt(localStorage.getItem(this.versionKey));
    // }

    #versionedGroups = [];
    
    async loadVersionedGroups() {
        const result = await fetchGroupsData();
        this.#versionedGroups = result.map(group => group.name);
    }
    
    versionedGroups() {
        return this.#versionedGroups;
    }
}
