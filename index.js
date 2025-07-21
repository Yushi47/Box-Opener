module.exports = function boxOpener(mod) {
    const command = mod.command || mod.require.command;

    let hooks = [];
    let enabled = false;
    let boxEvent = null;
    let gacha_detected = false;
    let gacha_contract = 0n;
    let isLooting = false;
    let location = null;
    let timer = null;
    let delay = 5500;
    let useDelay = false;
    let statOpened = 0;
    let statStarted = null;
    let scanning = false;

    const hook = (...args) => {
        try {
            hooks.push(mod.hook(...args));
        } catch (error) {
            command.message(`Hook error: ${error.message}`);
        }
    };

    const unload = () => {
        try {
            if (hooks.length) {
                for (const h of hooks) {
                    mod.unhook(h);
                }
                hooks = [];
            }
        } catch (error) {
            command.message(`Unload error: ${error.message}`);
        }
    };

    const stop = (message) => {
        try {
            unload();
            if (scanning) {
                scanning = false;
                command.message("Scanning for a box is aborted.");
                return;
            }

            if (gacha_detected && gacha_contract) {
                mod.toServer("C_GACHA_CANCEL", 1, { id: gacha_contract });
            }

            mod.clearTimeout(timer);
            enabled = false;
            gacha_detected = false;
            gacha_contract = 0n;
            boxEvent = null;

            if (message) {
                command.message(message);
            }

            if (statStarted && statOpened > 0) {
                const timeElapsedMSec = Date.now() - statStarted;
                const d = new Date(timeElapsedMSec);
                const h = d.getUTCHours().toString().padStart(2, '0');
                const m = d.getUTCMinutes().toString().padStart(2, '0');
                const s = d.getUTCSeconds().toString().padStart(2, '0');
                command.message(`Box opener stopped. Opened: ${statOpened} boxes. Time elapsed: ${h}:${m}:${s}. Per box: ${(timeElapsedMSec / statOpened / 1000).toPrecision(2)} sec.`);
            }

            statOpened = 0;
            statStarted = null;
        } catch (error) {
            command.message(`Stop error: ${error.message}`);
        }
    };

    const useItem = () => {
        try {
            if (!enabled || !boxEvent) {
                return;
            }

            if (mod.game.inventory.getTotalAmount(boxEvent.id) === 0) {
                stop("You ran out of boxes, stopping.");
                return;
            }

            const use = () => {
                boxEvent.loc = location.loc;
                boxEvent.w = location.w;
                mod.toServer("C_USE_ITEM", 3, boxEvent);
                statOpened++;
            };

            if (gacha_detected && gacha_contract) {
                 const version = mod.majorPatchVersion >= 99 ? 2 : 1;
                 const payload = { id: gacha_contract };
                 if(version === 2) payload.amount = 1;
                 mod.toServer("C_GACHA_TRY", version, payload);
                 statOpened++;
            } else {
                 use();
            }

            if (useDelay || gacha_detected) {
                mod.clearTimeout(timer);
                timer = mod.setTimeout(useItem, delay);
            }
        } catch (error) {
            command.message(`Use item error: ${error.message}`);
        }
    };

    const load = () => {
        try {
            hook("C_USE_ITEM", 3, event => {
                try {
                    if (gacha_detected || !scanning) return;

                    boxEvent = event;
                    boxEvent.dbid = 0n;
                    scanning = false;
                    enabled = true;
                    statStarted = Date.now();

                    command.message(`Box set to: ${event.id}, proceeding to auto-open it with ${useDelay ? `a minimum ${delay / 1000} sec delay` : "no delay"}`);
                    timer = mod.setTimeout(useItem, delay);
                } catch (error) {
                    command.message(`C_USE_ITEM hook error: ${error.message}`);
                }
            });

            hook("S_SYSTEM_MESSAGE_LOOT_ITEM", 1, () => {
                try {
                    if (!enabled || !boxEvent || gacha_detected || isLooting) return;

                    isLooting = true;
                    if (!useDelay) {
                        mod.clearTimeout(timer);
                        useItem();
                    }
                } catch (error) {
                    command.message(`Loot message hook error: ${error.message}`);
                }
            });

            const gachaEndVersion = mod.majorPatchVersion >= 99 ? 3 : 1;
            hook("S_GACHA_END", gachaEndVersion, () => {
                try {
                    if (!enabled || !boxEvent || !gacha_detected) return;

                    mod.clearTimeout(timer);
                    if (useDelay) {
                        timer = mod.setTimeout(useItem, delay);
                    } else {
                        process.nextTick(useItem);
                    }
                } catch (error) {
                    command.message(`Gacha end hook error: ${error.message}`);
                }
            });

            const stopMessages = [
                "SMT_ITEM_MIX_NEED_METERIAL", "SMT_CANT_CONVERT_NOW",
                "SMT_GACHA_NO_MORE_ITEM_SHORT", "SMT_NOTI_LEFT_LIMITED_GACHA_ITEM",
                "SMT_GACHA_CANCEL", "SMT_COMMON_NO_MORE_ITEM_TO_USE"
            ];

            hook("S_SYSTEM_MESSAGE", 1, event => {
                try {
                    const msg = mod.parseSystemMessage(event.message).id;
                    if (stopMessages.includes(msg)) {
                        stop("Box can not be opened anymore, stopping.");
                    }
                } catch (error) {
                    command.message(`System message hook error: ${error.message}`);
                }
            });

            if (mod.majorPatchVersion >= 93) {
                hook("S_REQUEST_CONTRACT", mod.majorPatchVersion > 107 ? 2 : 1, event => {
                    try {
                        if (event.type !== 53) return;

                        const gachaStartVersion = mod.majorPatchVersion >= 99 ? 2 : 1;
                        mod.hookOnce("S_GACHA_START", gachaStartVersion, () => {
                            try {
                                gacha_detected = true;
                                gacha_contract = event.id;
                                useItem();
                                return false;
                            } catch (error) {
                                command.message(`Gacha start hook error: ${error.message}`);
                                return false;
                            }
                        });
                        return false;
                    } catch (error) {
                        command.message(`Request contract hook error: ${error.message}`);
                        return false;
                    }
                });

                hook("S_CANCEL_CONTRACT", 1, event => {
                    try {
                        if (!gacha_detected || event.type !== 53) return;
                        stop("Gacha cancelled.");
                    } catch (error) {
                        command.message(`Cancel contract hook error: ${error.message}`);
                    }
                });
            } else {
                hook("S_GACHA_START", 1, event => {
                    try {
                        gacha_detected = true;
                        mod.toServer("C_GACHA_TRY", 1, { id: event.id });
                    } catch (error) {
                        command.message(`Legacy gacha start hook error: ${error.message}`);
                    }
                });
            }
        } catch (error) {
            command.message(`Load error: ${error.message}`);
        }
    };

    command.add("box", () => {
        try {
            if (!enabled && !scanning) {
                scanning = true;
                load();
                command.message("Please normally open a box now and the script will continue opening it.");
            } else {
                stop("Box opener stopped.");
            }
        } catch (error) {
            command.message(`Box command error: ${error.message}`);
        }
    });

    command.add("boxdelay", (arg) => {
        try {
            const value = parseInt(arg);
            if (!isNaN(value) && value >= 0) {
                useDelay = value > 0;
                delay = useDelay ? value : 5500;
                command.message(`Minimum box opening delay is set to: ${useDelay ? `${delay / 1000} sec` : "no delay"}.`);
            } else {
                command.message(`Current delay is: ${useDelay ? `${delay / 1000} sec` : "no delay"}.`);
            }
        } catch (error) {
            command.message(`Box delay command error: ${error.message}`);
        }
    });

    mod.hook("C_PLAYER_LOCATION", 5, event => { 
        try {
            location = event;
        } catch (error) {
            command.message(`Player location hook error: ${error.message}`);
        }
    });
    
    try {
        mod.game.initialize("inventory");
        mod.game.inventory.on("update", () => {
            try {
                if (enabled) isLooting = false;
            } catch (error) {
                command.message(`Inventory update error: ${error.message}`);
            }
        });
    } catch (error) {
        command.message(`Game initialization error: ${error.message}`);
    }
};