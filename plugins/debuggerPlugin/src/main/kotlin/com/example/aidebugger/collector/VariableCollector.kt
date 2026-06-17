package com.example.aidebugger.collector

import com.example.aidebugger.model.Variable
import com.example.aidebugger.settings.AiDebuggerSettings
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.ui.SimpleTextAttributes
import com.intellij.xdebugger.frame.XCompositeNode
import com.intellij.xdebugger.frame.XDebuggerTreeNodeHyperlink
import com.intellij.xdebugger.frame.XStackFrame
import com.intellij.xdebugger.frame.XValue
import com.intellij.xdebugger.frame.XValueChildrenList
import com.intellij.xdebugger.frame.XValueNode
import com.intellij.xdebugger.frame.XValuePlace
import com.intellij.xdebugger.frame.XFullValueEvaluator
import com.intellij.xdebugger.frame.presentation.XValuePresentation
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import javax.swing.Icon

object VariableCollector {

    private const val MAX_VALUE_LENGTH = 200
    private const val TRUNCATION_SUFFIX = "...(truncated)"
    private const val COLLECT_TIMEOUT_SECONDS = 4L

    fun collectVariables(frame: XStackFrame): List<Variable> {
        val settings = AiDebuggerSettings.getInstance()
        return collectFromFrame(frame, settings.variableDepth, settings.collectionMaxSize)
    }

    private fun collectFromFrame(
        frame: XStackFrame,
        maxDepth: Int,
        maxCollectionSize: Int
    ): List<Variable> {
        val future = CompletableFuture<List<Variable>>()

        frame.computeChildren(makeCompositeNode(future, maxDepth, maxCollectionSize))

        return try {
            future.get(COLLECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (e: Exception) {
            emptyList()
        }
    }

    private fun makeCompositeNode(
        future: CompletableFuture<List<Variable>>,
        maxDepth: Int,
        maxCollectionSize: Int
    ): XCompositeNode {
        return object : XCompositeNode {
            override fun addChildren(children: XValueChildrenList, last: Boolean) {
                val variables = mutableListOf<Variable>()
                val pending = mutableListOf<CompletableFuture<Variable?>>()

                val count = minOf(children.size(), maxCollectionSize)
                for (i in 0 until count) {
                    val name = children.getName(i)
                    val xValue = children.getValue(i)
                    pending.add(resolveValue(name, xValue, maxDepth - 1, maxCollectionSize))
                }

                if (pending.isEmpty()) {
                    if (last) future.complete(variables)
                    return
                }

                CompletableFuture.allOf(*pending.toTypedArray()).thenRun {
                    pending.forEach { f -> f.getNow(null)?.let { variables.add(it) } }
                    if (last) future.complete(variables)
                }
            }

            override fun tooManyChildren(remaining: Int) {
                if (!future.isDone) future.complete(emptyList())
            }

            override fun setAlreadySorted(alreadySorted: Boolean) {}

            override fun setErrorMessage(errorMessage: String) {
                if (!future.isDone) future.complete(emptyList())
            }

            override fun setErrorMessage(errorMessage: String, link: XDebuggerTreeNodeHyperlink?) {
                if (!future.isDone) future.complete(emptyList())
            }

            override fun setMessage(
                message: String,
                icon: Icon?,
                attributes: SimpleTextAttributes,
                link: XDebuggerTreeNodeHyperlink?
            ) {}
        }
    }

    private fun resolveValue(
        name: String,
        xValue: XValue,
        remainingDepth: Int,
        maxCollectionSize: Int
    ): CompletableFuture<Variable?> {
        val future = CompletableFuture<Variable?>()

        xValue.computePresentation(object : XValueNode {
            override fun setPresentation(
                icon: Icon?,
                type: String?,
                value: String,
                hasChildren: Boolean
            ) {
                val truncatedValue = truncateValue(value)
                if (hasChildren && remainingDepth > 0) {
                    collectChildren(xValue, remainingDepth - 1, maxCollectionSize).thenAccept { children ->
                        future.complete(Variable(name, truncatedValue, type ?: "unknown", children))
                    }
                } else {
                    future.complete(Variable(name, truncatedValue, type ?: "unknown"))
                }
            }

            override fun setPresentation(
                icon: Icon?,
                presentation: XValuePresentation,
                hasChildren: Boolean
            ) {
                val rawValue = renderPresentation(presentation)
                val truncatedValue = truncateValue(rawValue)
                val typeName = presentation.type ?: "unknown"

                if (hasChildren && remainingDepth > 0) {
                    collectChildren(xValue, remainingDepth - 1, maxCollectionSize).thenAccept { children ->
                        future.complete(Variable(name, truncatedValue, typeName, children))
                    }
                } else {
                    future.complete(Variable(name, truncatedValue, typeName))
                }
            }

            override fun setFullValueEvaluator(fullValueEvaluator: XFullValueEvaluator) {}
        }, XValuePlace.TREE)

        return future
    }

    private fun renderPresentation(presentation: XValuePresentation): String {
        val sb = StringBuilder()
        presentation.renderValue(object : XValuePresentation.XValueTextRenderer {
            override fun renderValue(value: String) { sb.append(value) }
            override fun renderValue(value: String, key: TextAttributesKey) { sb.append(value) }
            override fun renderStringValue(value: String) { sb.append("\"$value\"") }
            override fun renderStringValue(value: String, additionalSpecialCharsToHighlight: String?, maxLength: Int) {
                sb.append("\"$value\"")
            }
            override fun renderNumericValue(value: String) { sb.append(value) }
            override fun renderKeywordValue(value: String) { sb.append(value) }
            override fun renderComment(comment: String) { sb.append(comment) }
            override fun renderSpecialSymbol(symbol: String) { sb.append(symbol) }
            override fun renderError(error: String) { sb.append("<error: $error>") }
        })
        return sb.toString()
    }

    private fun collectChildren(
        xValue: XValue,
        remainingDepth: Int,
        maxCollectionSize: Int
    ): CompletableFuture<List<Variable>> {
        val future = CompletableFuture<List<Variable>>()

        xValue.computeChildren(object : XCompositeNode {
            override fun addChildren(children: XValueChildrenList, last: Boolean) {
                val childFutures = mutableListOf<CompletableFuture<Variable?>>()
                val count = minOf(children.size(), maxCollectionSize)
                for (i in 0 until count) {
                    childFutures.add(
                        resolveValue(children.getName(i), children.getValue(i), remainingDepth, maxCollectionSize)
                    )
                }

                if (childFutures.isEmpty()) {
                    if (last && !future.isDone) future.complete(emptyList())
                    return
                }

                CompletableFuture.allOf(*childFutures.toTypedArray()).thenRun {
                    val result = childFutures.mapNotNull { it.getNow(null) }
                    if (last && !future.isDone) future.complete(result)
                }
            }

            override fun tooManyChildren(remaining: Int) {
                if (!future.isDone) future.complete(emptyList())
            }

            override fun setAlreadySorted(alreadySorted: Boolean) {}

            override fun setErrorMessage(errorMessage: String) {
                if (!future.isDone) future.complete(emptyList())
            }

            override fun setErrorMessage(errorMessage: String, link: XDebuggerTreeNodeHyperlink?) {
                if (!future.isDone) future.complete(emptyList())
            }

            override fun setMessage(
                message: String,
                icon: Icon?,
                attributes: SimpleTextAttributes,
                link: XDebuggerTreeNodeHyperlink?
            ) {}
        })

        return future
    }

    private fun truncateValue(value: String): String =
        if (value.length > MAX_VALUE_LENGTH) value.substring(0, MAX_VALUE_LENGTH) + TRUNCATION_SUFFIX
        else value
}
