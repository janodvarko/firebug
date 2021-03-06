/* See license.txt for terms of usage */

define([
    "firebug/lib/object",
    "firebug/firebug",
    "firebug/lib/domplate",
    "firebug/lib/locale",
    "firebug/lib/events",
    "firebug/lib/css",
    "firebug/lib/dom",
    "firebug/lib/xml",
    "firebug/lib/url",
    "firebug/js/sourceLink",
    "firebug/chrome/menu",
    "firebug/lib/string",
    "firebug/lib/persist",
    "firebug/css/cssReps"
],
function(Obj, Firebug, Domplate, Locale, Events, Css, Dom, Xml, Url, SourceLink, Menu,
    Str, Persist, CSSInfoTip) {

with (Domplate) {

//********************************************************************************************* //
// Constants

const Cu = Components.utils;

const statusClasses = ["cssUnmatched", "cssParentMatch", "cssOverridden", "cssBestMatch"];

try
{
    Cu.import("resource:///modules/devtools/CssLogic.jsm");
}
catch (err)
{
    if (FBTrace.DBG_ERRORS)
        FBTrace.sysout("cssComputedPanel: EXCEPTION CssLogic is not available!");
}

// ********************************************************************************************* //
// CSS Computed panel (HTML side panel)

function CSSComputedPanel() {}

CSSComputedPanel.prototype = Obj.extend(Firebug.Panel,
{
    template: domplate(
    {
        computedStylesTag:
            DIV({"class": "a11yCSSView", role: "list", "aria-label":
                Locale.$STR("aria.labels.computed styles")}),

        groupedStylesTag:
            FOR("group", "$groups",
                DIV({"class": "computedStylesGroup", $opened: "$group.opened", role: "list",
                        $hidden: "$group.props|hasNoStyles", _repObject: "$group"},
                    H1({"class": "cssComputedHeader groupHeader focusRow", role: "listitem"},
                        IMG({"class": "twisty", role: "presentation"}),
                        SPAN({"class": "cssComputedLabel"}, "$group.title")
                    ),
                    TAG("$stylesTag", {props: "$group.props"})
                )
            ),

        stylesTag:
            TABLE({"class": "computedStyleTable", role: "list"},
                TBODY({role: "presentation"},
                    FOR("prop", "$props",
                        TR({"class": "focusRow computedStyleRow computedStyle",
                                $opened: "$prop.opened", role: "listitem",
                                $hasSelectors: "$prop|hasSelectors", _repObject: "$prop"},
                            TD({"class": "stylePropName", role: "presentation"},
                                "$prop.property"
                            ),
                            TD({role: "presentation"},
                                SPAN({"class": "stylePropValue"}, "$prop.value|formatValue"))
                        ),
                        TR({"class": "focusRow computedStyleRow matchedSelectors", _repObject: "$prop"},
                            TD({colspan: 2},
                                TAG("$selectorsTag", {prop: "$prop"})
                            )
                        )
                    )
                )
            ),

        selectorsTag:
            TABLE({"class": "matchedSelectorsTable", role: "list"},
                TBODY({role: "presentation"},
                    FOR("selector", "$prop.matchedSelectors",
                        TR({"class": "focusRow computedStyleRow styleSelector "+
                            "$selector.status|getStatusClass", role: "listitem",
                                _repObject: "$selector"},
                            TD({"class": "selectorName", role: "presentation"},
                                "$selector.selector.text"),
                            TD({role: "presentation"},
                                SPAN({"class": "stylePropValue"}, "$selector.value")),
                            TD({"class": "styleSourceLink", role: "presentation"},
                                TAG(FirebugReps.SourceLink.tag, {object: "$selector|getSourceLink"})
                            )
                        )
                    )
                )
            ),

        getStatusClass: function(status)
        {
            return statusClasses[status];
        },

        hasNoStyles: function(props)
        {
            return props.length == 0;
        },

        hasSelectors: function(prop)
        {
            return prop.matchedRuleCount != 0;
        },

        getSourceLink: function(selector)
        {
            var href = selector.href.href || selector.href;
            var line = selector.ruleLine;
            var rule = selector.selector._cssRule._domRule;

            var instance = Css.getInstanceForStyleSheet(rule.parentStyleSheet);
            var sourceLink = line != -1 ? new SourceLink.SourceLink(href, line, "css",
                rule, instance) : null;

            return sourceLink;
        },

        formatValue: function(value)
        {
            // Add a zero-width space after a comma to allow line breaking
            return value.replace(/,/g, ",\u200B");
        }
    }),

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

    updateComputedView: function(element)
    {
        function isUnwantedProp(propName)
        {
            return !Firebug.showMozillaSpecificStyles && Str.hasPrefix(propName, "-moz")
        }

        var win = element.ownerDocument.defaultView;
        var computedStyle = win.getComputedStyle(element);

        if (this.cssLogic)
            this.cssLogic.highlight(element);

        var props = [];
        for (var i = 0; i < computedStyle.length; ++i)
        {
            var prop = this.cssLogic ? this.cssLogic.getPropertyInfo(computedStyle[i]) :
                Firebug.CSSModule.getPropertyInfo(computedStyle, computedStyle[i]);

            if (isUnwantedProp(prop.property) ||
                (this.cssLogic && !Firebug.showUserAgentCSS && prop.matchedRuleCount == 0))
            {
                continue;
            }

            props.push(prop);
        }

        var parentNode = this.template.computedStylesTag.replace({}, this.panelNode);

        if (props.length != 0)
        {
            if (Firebug.computedStylesDisplay == "alphabetical")
            {
                this.sortProperties(props);

                for (var i = 0; i < props.length; ++i)
                    props[i].opened = this.styleOpened[props[i].property];

                var result = this.template.stylesTag.replace({props: props}, parentNode);
            }
            else
            {
                var groups = [];
                for (var groupName in styleGroups)
                {
                    var title = Locale.$STR("StyleGroup-" + groupName);
                    var group = {name: groupName, title: title, props: []};

                    var groupProps = styleGroups[groupName];
                    for (var i = 0; i < groupProps.length; ++i)
                    {
                        var propName = groupProps[i];
                        if (isUnwantedProp(propName))
                            continue;

                        var prop = this.cssLogic ? this.cssLogic.getPropertyInfo(propName) :
                            Firebug.CSSModule.getPropertyInfo(computedStyle, propName);

                        if (!Firebug.showUserAgentCSS && prop.matchedRuleCount == 0)
                            continue;

                        prop.opened = this.styleOpened[propName];

                        group.props.push(prop);

                        for (var j = 0; j < props.length; ++j)
                        {
                            if (props[j].property == propName)
                            {
                                props.splice(j, 1);
                                break;
                            }
                        }
                    }

                    group.opened = this.groupOpened[groupName];

                    groups.push(group);
                }

                if (props.length > 0)
                {
                    var group = groups[groups.length-1];
                    for (var i = 0; i < props.length; ++i)
                    {
                        var propName = props[i].property;
                        if (isUnwantedProp(propName))
                            continue;

                        var prop = this.cssLogic ? this.cssLogic.getPropertyInfo(propName) :
                            Firebug.CSSModule.getPropertyInfo(computedStyle, propName);

                        prop.opened = this.styleOpened[propName];

                        group.props.push(prop);
                    }

                    group.opened = this.groupOpened[group.name];
                }

                var result = this.template.groupedStylesTag.replace({groups: groups}, parentNode);
            }
        }
        else
        {
            FirebugReps.Warning.tag.replace({object: "computed.No_User-Defined_Styles"},
                this.panelNode);
        }

        Events.dispatch(this.fbListeners, "onCSSRulesAdded", [this, result]);
    },

    toggleGroup: function(node)
    {
        var groupNode = Dom.getAncestorByClass(node, "computedStylesGroup");
        var group = Firebug.getRepObject(groupNode);

        Css.toggleClass(groupNode, "opened");
        var opened = Css.hasClass(groupNode, "opened");
        this.groupOpened[group.name] = opened;

        if (opened)
        {
            var offset = Dom.getClientOffset(node);
            var titleAtTop = offset.y < this.panelNode.scrollTop;
            Dom.scrollTo(groupNode, this.panelNode, null,
                groupNode.offsetHeight > this.panelNode.clientHeight || titleAtTop ? "top" : "bottom");
        }
    },

    toggleAllStyles: function(event, expand)
    {
        var computedStyles = this.panelNode.getElementsByClassName("computedStyle");

        for (var i = 0; i < computedStyles.length; ++i)
        {
            if (!Css.hasClass(computedStyles[i], "hasSelectors"))
                continue;

            var isOpened = Css.hasClass(computedStyles[i], "opened");
            if ((expand && !isOpened) || (!expand && isOpened))
                this.toggleStyle(computedStyles[i]);
        }
    },

    toggleStyle: function(node)
    {
        var styleNode = Dom.getAncestorByClass(node, "computedStyle");
        var style = Firebug.getRepObject(styleNode);

        Css.toggleClass(styleNode, "opened");
        this.styleOpened[style.property] = Css.hasClass(styleNode, "opened");
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Events

    onClick: function(event)
    {
        if (!Events.isLeftClick(event))
            return;

        var cssComputedHeader = Dom.getAncestorByClass(event.target, "cssComputedHeader");
        if (cssComputedHeader)
        {
            this.toggleGroup(event.target);
            return;
        }

        var computedStyle = Dom.getAncestorByClass(event.target, "computedStyle");
        if (computedStyle && Css.hasClass(computedStyle, "hasSelectors"))
        {
            this.toggleStyle(event.target);
            return;
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // extends Panel

    name: "computed",
    parentPanel: "html",
    order: 1,

    initialize: function()
    {
        if (typeof CssLogic != "undefined")
            this.cssLogic = new CssLogic();

        this.groupOpened = [];
        for (var groupName in styleGroups)
            this.groupOpened[groupName] = true;

        this.styleOpened = [];

        // Listen for CSS changes so the Computed panel is properly updated when needed.
        Firebug.CSSModule.addListener(this);

        this.onClick = Obj.bind(this.onClick, this);

        Firebug.Panel.initialize.apply(this, arguments);
    },

    destroy: function(state)
    {
        state.scrollTop = this.panelNode.scrollTop ? this.panelNode.scrollTop : this.lastScrollTop;
        state.groupOpened = this.groupOpened;
        state.styleOpened = this.styleOpened;

        Persist.persistObjects(this, state);

        Firebug.CSSModule.removeListener(this);

        Firebug.Panel.destroyNode.apply(this, arguments);
    },

    initializeNode: function(oldPanelNode)
    {
        Events.addEventListener(this.panelNode, "click", this.onClick, false);

        Firebug.Panel.initializeNode.apply(this, arguments);
    },

    destroyNode: function()
    {
        Events.removeEventListener(this.panelNode, "click", this.onClick, false);

        Firebug.Panel.destroyNode.apply(this, arguments);
    },

    show: function(state)
    {
        // Wait for loadedContext to restore the panel
        if (this.context.loaded)
        {
            var state;
            Persist.restoreObjects(this, state);

            if (state)
            {
                if (state.scrollTop)
                    this.panelNode.scrollTop = state.scrollTop;

                if (state.groupOpened)
                    this.groupOpened = state.groupOpened;

                if (state.styleOpened)
                    this.styleOpened = state.styleOpened;
            }
        }

        if (this.selection)
            this.refresh();
    },

    hide: function()
    {
        this.lastScrollTop = this.panelNode.scrollTop;
    },

    updateView: function(element)
    {
        this.updateComputedView(element);
    },

    supportsObject: function(object, type)
    {
        return object instanceof window.Element ? 1 : 0;
    },

    refresh: function()
    {
        this.updateSelection(this.selection);
    },

    updateSelection: function(element)
    {
        this.updateComputedView(element);
    },

    updateOption: function(name, value)
    {
        var optionMap = {
            showUserAgentCSS: 1,
            computedStylesDisplay: 1,
            showMozillaSpecificStyles: 1
        };

        if (name in optionMap)
            this.refresh();
    },

    getOptionsMenuItems: function()
    {
        var items = [];

        if (this.cssLogic)
        {
            items.push(
                Menu.optionMenu("Show_User_Agent_CSS", "showUserAgentCSS",
                "style.option.tip.Show_User_Agent_CSS")
            );
        }

        items.push(
            {
                label: "Sort_alphabetically",
                type: "checkbox",
                checked: Firebug.computedStylesDisplay == "alphabetical",
                tooltiptext: "computed.option.tip.Sort_Alphabetically",
                command: Obj.bind(this.toggleDisplay, this)
            },
            Menu.optionMenu("Show_Mozilla_specific_styles",
                "showMozillaSpecificStyles",
                "computed.option.tip.Show_Mozilla_Specific_Styles")
        );

        return items;
    },

    getContextMenuItems: function(style, target)
    {
        var items = [];
        var computedStyles = this.panelNode.getElementsByClassName("computedStyle");
        var expandAll = false;
        var collapseAll = false;
        for (var i = 0; i < computedStyles.length; ++i)
        {
            if (!Css.hasClass(computedStyles[i], "hasSelectors"))
                continue;

            if (!expandAll && !Css.hasClass(computedStyles[i], "opened"))
                expandAll = true;
            if (!collapseAll && Css.hasClass(computedStyles[i], "opened"))
                collapseAll = true;
        }

        if (expandAll)
        {
            items.push(
                {
                    label: "computed.option.label.Expand_All_Styles",
                    command: Obj.bind(this.toggleAllStyles, this, true),
                    tooltiptext: "computed.option.tip.Expand_All_Styles"
                }
            );
        }

        if (collapseAll)
        {
            items.push(
                {
                    label: "computed.option.label.Collapse_All_Styles",
                    command: Obj.bind(this.toggleAllStyles, this, false),
                    tooltiptext: "computed.option.tip.Collapse_All_Styles"
                }
            );
        }

        items.push(
            "-",
            {
                label: "Refresh",
                command: Obj.bind(this.refresh, this),
                tooltiptext: "panel.tip.Refresh"
            }
        );

        return items;
    },

    onMouseDown: function(event)
    {
        if (!Events.isLeftClick(event))
            return;

        var cssComputedHeader = Dom.getAncestorByClass(event.target, "cssComputedHeader");
        if (cssComputedHeader)
            this.toggleNode(event);
    },

    toggleNode: function(event)
    {
        var group = Dom.getAncestorByClass(event.target, "computedStylesGroup");
        var groupName = group.getElementsByClassName("cssComputedLabel")[0].textContent;

        Css.toggleClass(group, "opened");
        this.groupOpened[groupName] = Css.hasClass(group, "opened");
    },

    toggleDisplay: function()
    {
        var display = Firebug.computedStylesDisplay == "alphabetical" ? "grouped" : "alphabetical";
        Firebug.Options.set("computedStylesDisplay", display);
    },

    sortProperties: function(props)
    {
        props.sort(function(a, b)
        {
            return a.property > b.property ? 1 : -1;
        });
    },

    getStylesheetURL: function(rule, getBaseUri)
    {
        // if the parentStyleSheet.href is null, CSS std says its inline style
        if (rule && rule.parentStyleSheet && rule.parentStyleSheet.href)
            return rule.parentStyleSheet.href;
        else if (getBaseUri)
            return this.selection.ownerDocument.baseURI;
        else
            return this.selection.ownerDocument.location.href;
    },

    showInfoTip: function(infoTip, target, x, y, rangeParent, rangeOffset)
    {
        var propValue = Dom.getAncestorByClass(target, "stylePropValue");
        if (propValue)
        {
            var propInfo = Firebug.getRepObject(target);

            var prop = propInfo.property, value = propInfo.value;
            var cssValue;

            if (prop == "font" || prop == "font-family")
            {
                if (value.charAt(rangeOffset) == ",")
                    return;

                cssValue = Firebug.CSSModule.parseCSSFontFamilyValue(value, rangeOffset, prop);
            }
            else
            {
                cssValue = Firebug.CSSModule.parseCSSValue(value, rangeOffset);
            }

            if (!cssValue)
                return false;

            if (cssValue.value == this.infoTipValue)
                return true;

            this.infoTipValue = cssValue.value;

            switch (cssValue.type)
            {
                case "rgb":
                case "hsl":
                case "gradient":
                case "colorKeyword":
                    this.infoTipType = "color";
                    this.infoTipObject = cssValue.value;
                    return CSSInfoTip.populateColorInfoTip(infoTip, cssValue.value);

                case "url":
                    if (Css.isImageRule(Xml.getElementSimpleType(Firebug.getRepObject(target)), prop))
                    {
                        var baseURL = propInfo.href || propInfo.matchedSelectors[0].href;
                        var relURL = Firebug.CSSModule.parseURLValue(cssValue.value);
                        var absURL = Url.isDataURL(relURL) ? relURL : Url.absoluteURL(relURL, baseURL);
                        var repeat = Firebug.CSSModule.parseRepeatValue(value);

                        this.infoTipType = "image";
                        this.infoTipObject = absURL;

                        return CSSInfoTip.populateImageInfoTip(infoTip, absURL, repeat);
                    }

                case "fontFamily":
                    return CSSInfoTip.populateFontFamilyInfoTip(infoTip, cssValue.value);
            }

            delete this.infoTipType;
            delete this.infoTipValue;
            delete this.infoTipObject;
        }
    },

    // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //
    // Change Listener

    onCSSInsertRule: function(styleSheet, cssText, ruleIndex)
    {
        // Force update, this causes updateSelection to be called.
        // See {@link Firebug.Panel.select}
        this.selection = null;
    },

    onCSSDeleteRule: function(styleSheet, ruleIndex)
    {
        this.selection = null;
    },

    onCSSSetProperty: function(style, propName, propValue, propPriority, prevValue,
        prevPriority, rule, baseText)
    {
        this.selection = null;
    },

    onCSSRemoveProperty: function(style, propName, prevValue, prevPriority, rule, baseText)
    {
        this.selection = null;
    }
});

//********************************************************************************************* //
//Helpers

const styleGroups =
{
    text: [
        "font-family",
        "font-size",
        "font-weight",
        "font-style",
        "font-size-adjust",
        "color",
        "text-transform",
        "text-decoration",
        "letter-spacing",
        "word-spacing",
        "line-height",
        "text-align",
        "vertical-align",
        "direction",
        "column-count",
        "column-gap",
        "column-width",
        "-moz-tab-size", // FF4.0
        "-moz-font-feature-settings", // FF4.0
        "-moz-font-language-override", // FF4.0
        "-moz-text-blink", // FF6.0
        "-moz-text-decoration-color", // FF6.0
        "-moz-text-decoration-line", // FF6.0
        "-moz-text-decoration-style", // FF6.0
        "hyphens", // FF 6.0
        "text-overflow" // FF7.0
    ],

    background: [
        "background-color",
        "background-image",
        "background-repeat",
        "background-position",
        "background-attachment",
        "opacity",
        "background-clip",
        "-moz-background-inline-policy",
        "background-origin",
        "background-size",
        "-moz-image-region"
    ],

    box: [
        "width",
        "height",
        "top",
        "right",
        "bottom",
        "left",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "-moz-padding-start",
        "-moz-padding-end",
        "border-top-width",
        "border-right-width",
        "border-bottom-width",
        "border-left-width",
        "border-top-color",
        "-moz-border-top-colors",
        "border-right-color",
        "-moz-border-right-colors",
        "border-bottom-color",
        "-moz-border-bottom-colors",
        "border-left-color",
        "-moz-border-left-colors",
        "border-top-style",
        "border-right-style",
        "border-bottom-style",
        "border-left-style",
        "-moz-border-end",
        "-moz-border-end-color",
        "-moz-border-end-style",
        "-moz-border-end-width",
        "-moz-border-image",
        "-moz-border-start",
        "-moz-border-start-color",
        "-moz-border-start-style",
        "-moz-border-start-width",
        "border-top-left-radius",
        "border-top-right-radius",
        "border-bottom-left-radius",
        "border-bottom-right-radius",
        "-moz-outline-radius-bottomleft",
        "-moz-outline-radius-bottomright",
        "-moz-outline-radius-topleft",
        "-moz-outline-radius-topright",
        "box-shadow",
        "outline-color",
        "outline-offset",
        "outline-top-width",
        "outline-right-width",
        "outline-bottom-width",
        "outline-left-width",
        "outline-top-color",
        "outline-right-color",
        "outline-bottom-color",
        "outline-left-color",
        "outline-top-style",
        "outline-right-style",
        "outline-bottom-style",
        "outline-left-style",
        "-moz-box-align",
        "-moz-box-direction",
        "-moz-box-flex",
        "-moz-box-ordinal-group",
        "-moz-box-orient",
        "-moz-box-pack",
        "-moz-box-sizing",
        "-moz-margin-start",
        "-moz-margin-end"
    ],

    layout: [
        "position",
        "display",
        "visibility",
        "z-index",
        "overflow-x",  // http://www.w3.org/TR/2002/WD-css3-box-20021024/#overflow
        "overflow-y",
        "overflow-clip",
        "-moz-transform",
        "-moz-transform-origin",
        "white-space",
        "clip",
        "float",
        "clear",
        "-moz-appearance",
        "-moz-stack-sizing",
        "-moz-column-count",
        "-moz-column-gap",
        "-moz-column-width",
        "-moz-column-rule",
        "-moz-column-rule-width",
        "-moz-column-rule-style",
        "-moz-column-rule-color",
        "-moz-float-edge",
        "orient"
    ],

    other: []
};

//********************************************************************************************* //
//Registration

Firebug.registerPanel(CSSComputedPanel);

return CSSComputedPanel;

//********************************************************************************************* //
}});
